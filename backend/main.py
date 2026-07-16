import asyncio
import logging
import math
from datetime import datetime, timedelta
import json
from typing import List, Dict, Any
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from vwap_strategy import VWAPStrategy
from mock_feed import MockFeedGenerator, SCRIPS
from sim_broker import SimulatedBroker
from shoonya_client import ShoonyaClient
from fyers_client import FyersClientWrapper, SYMBOL_MAP_UI_TO_FYERS

class OptionCandleBuilder:
    def __init__(self, interval_minutes=1):
        self.interval_minutes = interval_minutes
        self.candles = []
        self.active_candle = None
        
    def process_tick(self, timestamp: datetime, price: float, volume: float):
        aligned_ts = timestamp - timedelta(
            minutes=timestamp.minute % self.interval_minutes,
            seconds=timestamp.second,
            microseconds=timestamp.microsecond
        )
        
        new_candle = False
        if self.active_candle is None:
            self.active_candle = {
                "time": aligned_ts,
                "open": price,
                "high": price,
                "low": price,
                "close": price,
                "volume": volume
            }
            new_candle = True
        elif self.active_candle["time"] != aligned_ts:
            # Finalize previous active candle
            self.candles.append(self.active_candle.copy())
            if len(self.candles) > 1000:
                self.candles.pop(0)
            
            # Start new active candle
            self.active_candle = {
                "time": aligned_ts,
                "open": price,
                "high": price,
                "low": price,
                "close": price,
                "volume": volume
            }
            new_candle = True
        else:
            self.active_candle["high"] = max(self.active_candle["high"], price)
            self.active_candle["low"] = min(self.active_candle["low"], price)
            self.active_candle["close"] = price
            self.active_candle["volume"] += volume
            
        return self.get_active_payload(), new_candle
        
    def get_active_payload(self):
        if self.active_candle is None:
            return None
        c = self.active_candle.copy()
        c["time"] = int(c["time"].timestamp())
        return c
        
    def get_history_payload(self):
        payload = []
        for c in self.candles:
            cp = c.copy()
            cp["time"] = int(cp["time"].timestamp())
            payload.append(cp)
        return payload
        
    def reset(self):
        self.candles = []
        self.active_candle = None

def calculate_option_greeks(spot: float, strike: float, is_call: bool, vix: float = 15.0, days_to_expiry: float = 3.0):
    T = max(0.001, days_to_expiry / 365.0)
    r = 0.07 # 7% risk-free rate
    sigma = max(0.05, vix / 100.0) # Implied Volatility
    
    d1 = (math.log(spot / strike) + (r + 0.5 * sigma**2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    
    # Standard normal CDF approximation
    def norm_cdf(x):
        return (1.0 + math.erf(x / math.sqrt(2.0))) / 2.0
        
    # Standard normal PDF
    def norm_pdf(x):
        return math.exp(-0.5 * x**2) / math.sqrt(2.0 * math.pi)
        
    nd1 = norm_cdf(d1)
    nd2 = norm_cdf(d2)
    np_d1 = norm_pdf(d1)
    
    if is_call:
        price = spot * nd1 - strike * math.exp(-r * T) * nd2
        delta = nd1
        # Theta decay per day (per calendar day)
        theta = (- (spot * np_d1 * sigma) / (2.0 * math.sqrt(T)) - r * strike * math.exp(-r * T) * nd2) / 365.0
    else:
        price = strike * math.exp(-r * T) * norm_cdf(-d2) - spot * norm_cdf(-d1)
        delta = nd1 - 1.0
        theta = (- (spot * np_d1 * sigma) / (2.0 * math.sqrt(T)) + r * strike * math.exp(-r * T) * norm_cdf(-d2)) / 365.0
        
    gamma = np_d1 / (spot * sigma * math.sqrt(T))
    vega = (spot * math.sqrt(T) * np_d1) / 100.0 # sensitivity per 1% IV change
    
    return {
        "price": max(1.0, float(round(price, 2))),
        "delta": float(round(delta, 3)),
        "theta": float(round(theta, 3)),
        "gamma": float(round(gamma, 5)),
        "vega": float(round(vega, 3))
    }


# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("main")

app = FastAPI(title="Shoonya VWAP Strategy Server")

# Enable CORS for React frontend (default Vite port is 5173)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# App Global State
class GlobalState:
    def __init__(self):
        self.mode = "FYERS" # "MOCK" or "LIVE" or "FYERS"
        self.active_scrip = "NSE|NIFTY 50"
        self.interval_minutes = 1
        self.num_std = 2.0
        self.qty = 100 # default order quantity
        self.auto_trade = False
        self.vix_value = 15.0
        self.min_checklist_score = 4 # default minimum checklist score
        self.active_safety_alert = None
        self.signals_history = [] # Keep a log of all signals generated
        self.load_signals_from_file() # Load saved signals from disk!
        self.telegram_token = ""
        self.telegram_chat_id = ""
        self.telegram_enabled = False
        self.load_telegram_config()
        
        # Option Premium and Greeks state
        self.active_strike = None
        self.call_builder = OptionCandleBuilder(self.interval_minutes)
        self.put_builder = OptionCandleBuilder(self.interval_minutes)
        self.greeks_days_to_expiry = 3.0 # default to 3 days to weekly expiry
        self.call_greeks = {"price": 0.0, "delta": 0.0, "theta": 0.0, "gamma": 0.0, "vega": 0.0}
        self.put_greeks = {"price": 0.0, "delta": 0.0, "theta": 0.0, "gamma": 0.0, "vega": 0.0}
        
        # Core engines
        self.strategies = {}
        from mock_feed import SCRIPS
        for scrip in SCRIPS.keys():
            self.strategies[scrip] = VWAPStrategy(interval_minutes=self.interval_minutes, num_std=self.num_std, min_checklist_score=self.min_checklist_score)
        self.mock_feed = MockFeedGenerator()
        self.shoonya = ShoonyaClient()
        self.fyers = FyersClientWrapper()
        self.sim_broker = SimulatedBroker(initial_balance=100000.0)
        self.reset_strategies()
 
    @property
    def strategy(self):
        return self.strategies.setdefault(self.active_scrip, VWAPStrategy(interval_minutes=self.interval_minutes, num_std=self.num_std, min_checklist_score=self.min_checklist_score))
        
    def reset_strategies(self):
        from mock_feed import SCRIPS
        self.strategies.clear()
        for scrip in SCRIPS.keys():
            self.strategies[scrip] = VWAPStrategy(interval_minutes=self.interval_minutes, num_std=self.num_std, min_checklist_score=self.min_checklist_score)
        
        # Thread/Task management
        self.feed_task = None
        self.websocket_connections: List[WebSocket] = []
        
        # Log cache to send to UI console
        self.log_messages: List[str] = []
        
        # Track cumulative volumes for live Shoonya ticks to compute incremental ticks
        self.last_cumulative_volumes: Dict[str, float] = {}

    def save_signals_to_file(self):
        try:
            import os
            # Save inside the backend workspace directory
            filepath = os.path.join(os.path.dirname(__file__), "signals_log.json")
            with open(filepath, "w") as f:
                json.dump(self.signals_history, f, indent=4)
        except Exception as e:
            logger.error(f"Error saving signals to file: {e}")

    def load_signals_from_file(self):
        try:
            import os
            filepath = os.path.join(os.path.dirname(__file__), "signals_log.json")
            if os.path.exists(filepath):
                with open(filepath, "r") as f:
                    self.signals_history = json.load(f)
                logger.info(f"Loaded {len(self.signals_history)} historical signals from signals_log.json.")
        except Exception as e:
            logger.error(f"Error loading signals from file: {e}")

    def load_telegram_config(self):
        try:
            import os
            filepath = os.path.join(os.path.dirname(__file__), "telegram_config.json")
            if os.path.exists(filepath):
                with open(filepath, "r") as f:
                    data = json.load(f)
                    self.telegram_token = data.get("telegram_token", "")
                    self.telegram_chat_id = data.get("telegram_chat_id", "")
                    self.telegram_enabled = data.get("telegram_enabled", False)
                logger.info("Loaded Telegram configuration from telegram_config.json.")
        except Exception as e:
            logger.error(f"Error loading telegram config: {e}")

    def save_telegram_config(self):
        try:
            import os
            filepath = os.path.join(os.path.dirname(__file__), "telegram_config.json")
            with open(filepath, "w") as f:
                json.dump({
                    "telegram_token": self.telegram_token,
                    "telegram_chat_id": self.telegram_chat_id,
                    "telegram_enabled": self.telegram_enabled
                }, f, indent=4)
            logger.info("Saved Telegram configuration to telegram_config.json.")
        except Exception as e:
            logger.error(f"Error saving telegram config: {e}")

state = GlobalState()

def send_telegram_notification(message: str):
    if not state.telegram_enabled or not state.telegram_token or not state.telegram_chat_id:
        return
    
    def _send():
        try:
            import requests
            url = f"https://api.telegram.org/bot{state.telegram_token}/sendMessage"
            payload = {
                "chat_id": state.telegram_chat_id,
                "text": message,
                "parse_mode": "HTML"
            }
            res = requests.post(url, json=payload, timeout=5)
            if not res.ok:
                logger.error(f"Telegram notification failed: {res.text}")
            else:
                logger.info("Telegram notification sent successfully.")
        except Exception as e:
            logger.error(f"Error sending Telegram notification: {e}")
            
    import threading
    threading.Thread(target=_send, daemon=True).start()

# Pydantic models for REST endpoints
class TelegramConfigModel(BaseModel):
    telegram_token: str
    telegram_chat_id: str
    telegram_enabled: bool

class ConfigModel(BaseModel):
    mode: str
    active_scrip: str
    interval_minutes: int
    num_std: float
    qty: int
    auto_trade: bool
    vix_value: float = 15.0
    days_to_expiry: float = 3.0
    min_checklist_score: int = 4

class ShoonyaLoginModel(BaseModel):
    userid: str
    password: str
    totp_secret: str
    api_key: str
    vendor_code: str

# Helper to log messages to UI console (fully thread-safe)
def ui_log(message):
    timestamp_str = datetime.now().strftime("%H:%M:%S")
    formatted_msg = f"[{timestamp_str}] {message}"
    logger.info(formatted_msg)
    state.log_messages.append(formatted_msg)
    if len(state.log_messages) > 100:
        state.log_messages.pop(0)
        
    # Thread-safe dispatch to the active asyncio loop
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(broadcast_payload({"type": "CONSOLE_LOG", "data": formatted_msg}))
    except RuntimeError:
        # No running loop in this thread, find and dispatch to the main loop safely
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.run_coroutine_threadsafe(
                    broadcast_payload({"type": "CONSOLE_LOG", "data": formatted_msg}), 
                    loop
                )
        except Exception:
            pass

# Broadcast to all active websockets
async def broadcast_payload(payload: Dict[str, Any]):
    disconnected = []
    for ws in state.websocket_connections:
        try:
            await ws.send_text(json.dumps(payload))
        except Exception:
            disconnected.append(ws)
            
    for ws in disconnected:
        if ws in state.websocket_connections:
            state.websocket_connections.remove(ws)

# Core tick processing callback
async def handle_incoming_tick(tick: dict):
    scrip = tick["scrip"]
    price = tick["price"]
    volume = tick["volume"]
    timestamp = tick["timestamp"]
    is_cumulative = tick.get("is_cumulative_volume", False)
    
    # Calculate incremental volume for live Shoonya ticks if needed
    actual_volume = volume
    if is_cumulative:
        last_cum = state.last_cumulative_volumes.get(scrip, 0.0)
        if last_cum > 0.0 and volume >= last_cum:
            actual_volume = volume - last_cum
        else:
            # First tick or day reset
            actual_volume = 100.0 # seed a base value
        state.last_cumulative_volumes[scrip] = volume
        
    # Process tick inside the VWAP Strategy for this scrip
    scrip_strategy = state.strategies.setdefault(scrip, VWAPStrategy(interval_minutes=state.interval_minutes, num_std=state.num_std))
    active_candle, new_candle_started = scrip_strategy.process_tick(timestamp, price, actual_volume, vix=state.vix_value)
    
    if active_candle:
        # Check for Strategy Signals
        signal = active_candle.get("signal", "HOLD")
        potential_signal = active_candle.get("potential_signal", "HOLD")
        
        # If this is the active scrip, calculate option greeks and candles
        if scrip == state.active_scrip:
            # Initialize active option strike if not set
            if state.active_strike is None or state.active_strike == 0:
                if "NIFTY 50" in scrip or "FIN SERVICE" in scrip:
                    strike_interval = 50
                else:
                    strike_interval = 100
                state.active_strike = int(round(price / strike_interval) * strike_interval)
                ui_log(f"🎯 ATM Option Strike established at {state.active_strike} for {scrip}")
                
            call_data = None
            put_data = None
            
            # If Fyers is authenticated, attempt to fetch the actual strike price data (LTP and IV) from Fyers Option Chain
            if state.mode == "FYERS" and state.fyers.authenticated and state.fyers.api:
                try:
                    fyers_sym = SYMBOL_MAP_UI_TO_FYERS.get(state.active_scrip, "NSE:NIFTY50-INDEX")
                    now = datetime.now()
                    
                    # Cache the option chain query for 4 seconds to prevent rate-limiting on live tick updates
                    if not hasattr(state, "last_option_chain_data") or not state.last_option_chain_data or \
                       not hasattr(state, "last_option_chain_time") or (now - state.last_option_chain_time).total_seconds() > 4.0:
                        chain_res = state.fyers.api.optionchain(data={"symbol": fyers_sym, "strikecount": 10})
                        if chain_res and chain_res.get("s") == "ok":
                            state.last_option_chain_data = chain_res.get("data", {}).get("optionsChain", [])
                            state.last_option_chain_time = now
                            
                    if hasattr(state, "last_option_chain_data") and state.last_option_chain_data:
                        ce_contract = None
                        pe_contract = None
                        for contract in state.last_option_chain_data:
                            if float(contract.get("strike_price")) == float(state.active_strike):
                                if contract.get("option_type") == "CE":
                                    ce_contract = contract
                                elif contract.get("option_type") == "PE":
                                    pe_contract = contract
                                    
                        if ce_contract and pe_contract:
                            ce_ltp = float(ce_contract.get("ltp", 0.0))
                            pe_ltp = float(pe_contract.get("ltp", 0.0))
                            ce_iv = float(ce_contract.get("iv", state.vix_value))
                            pe_iv = float(pe_contract.get("iv", state.vix_value))
                            
                            # Calculate greeks using the actual live option IV and days to expiry
                            ce_greeks = calculate_option_greeks(price, state.active_strike, True, vix=ce_iv, days_to_expiry=state.greeks_days_to_expiry)
                            pe_greeks = calculate_option_greeks(price, state.active_strike, False, vix=pe_iv, days_to_expiry=state.greeks_days_to_expiry)
                            
                            # Override theoretical premium with the actual live market traded LTP
                            ce_greeks["price"] = ce_ltp
                            pe_greeks["price"] = pe_ltp
                            
                            call_data = ce_greeks
                            put_data = pe_greeks
                except Exception as ex:
                    logger.error(f"Error fetching live option prices for strike {state.active_strike}: {ex}")
            
            # Fallback to theoretical Black-Scholes model if live options data is unavailable or mode is MOCK
            if not call_data or not put_data:
                call_data = calculate_option_greeks(price, state.active_strike, True, vix=state.vix_value, days_to_expiry=state.greeks_days_to_expiry)
                put_data = calculate_option_greeks(price, state.active_strike, False, vix=state.vix_value, days_to_expiry=state.greeks_days_to_expiry)
            
            state.call_greeks = call_data
            state.put_greeks = put_data
            
            # Update Option Builders
            call_candle, call_new = state.call_builder.process_tick(timestamp, call_data["price"], actual_volume * 0.1)
            put_candle, put_new = state.put_builder.process_tick(timestamp, put_data["price"], actual_volume * 0.1)

            # Print a detailed log to the UI console if a potential signal crossover was blocked by filters
            if potential_signal in ["BUY", "SELL"] and signal == "HOLD":
                checklist_score = active_candle.get("checklist_score", 0)
                reasons = []
                if checklist_score < 4:
                    reasons.append(f"Checklist score {checklist_score}/7 is below threshold (min 4 required)")
                if active_candle.get("vix_blocked"):
                    reasons.append(f"India VIX is {state.vix_value} (exceeds max filter limit of 22.0)")
                if active_candle.get("rsi_blocked"):
                    reasons.append(f"RSI(14) is {active_candle.get('rsi14')} (CE blocks if >72, PE blocks if <28)")
                if active_candle.get("time_blocked"):
                    reasons.append("Current time is past the 14:30 IST session entry deadline")
                if active_candle.get("trade_cap_blocked"):
                    reasons.append("Daily cap of 2000 trades per session reached")
                
                reason_str = ", ".join(reasons)
                ui_log(f"⚠️ [SIGNAL BLOCKED] Potential {'BULLISH' if potential_signal == 'BUY' else 'BEARISH'} setup detected on {scrip.split('|')[-1]}, but BLOCKED because: {reason_str}")
                
                # Broadcast blocked signal detail to frontend webpage!
                loop = asyncio.get_event_loop()
                asyncio.run_coroutine_threadsafe(
                    broadcast_payload({
                        "type": "BLOCKED_SIGNAL",
                        "data": {
                            "signal_type": "BULLISH" if potential_signal == "BUY" else "BEARISH",
                            "contract_name": f"{scrip.split('|')[-1].strip()} Index",
                            "reasons": reasons
                        }
                    }),
                    loop
                )

            # Send live update to chart including Call/Put options candles and Greeks
            await broadcast_payload({
                "type": "TICK",
                "data": {
                    "scrip": scrip,
                    "candle": active_candle,
                    "new_candle_started": new_candle_started,
                    "call_candle": call_candle,
                    "call_new": call_new,
                    "put_candle": put_candle,
                    "put_new": put_new,
                    "call_greeks": call_data,
                    "put_greeks": put_data,
                    "active_strike": state.active_strike
                }
            })
        else:
            # For non-active scrips, broadcast a lightweight price update so the Watchlist updates in real time!
            await broadcast_payload({
                "type": "PRICE_UPDATE",
                "data": {
                    "scrip": scrip,
                    "price": price
                }
            })
            
        # Option Signal Presentation (Call CE / Put PE ATM Option Recommendations with Targets/SL)
        if signal in ["BUY", "SELL"]:
            if "NIFTY 50" in scrip or "FIN SERVICE" in scrip:
                strike_interval = 50
            else:
                strike_interval = 100
            atm_strike = int(round(price / strike_interval) * strike_interval)
            
            # Fetch ATR value
            atr = active_candle.get("atr14", price * 0.002)
            
            # Calculate ATR-based index-level SL/TP (1.5x ATR SL, 2.5x ATR TP)
            index_risk = max(1.5 * atr, price * 0.002)
            if signal == "BUY":
                spot_sl = price - index_risk
                spot_tp = price + (2.5 * atr)
                option_type = "Call Option (CE)"
                option_name = f"{scrip.split('|')[-1].strip()} {atm_strike} CE"
            else:
                spot_sl = price + index_risk
                spot_tp = price - (2.5 * atr)
                option_type = "Put Option (PE)"
                option_name = f"{scrip.split('|')[-1].strip()} {atm_strike} PE"
            
            # Use actual live option LTP (or theoretical pricing fallback) and Delta for signal presentation
            if scrip == state.active_scrip:
                if signal == "BUY":
                    opt_entry = state.call_greeks.get("price", round(price * 0.008, 1))
                    delta = state.call_greeks.get("delta", 0.5)
                else:
                    opt_entry = state.put_greeks.get("price", round(price * 0.008, 1))
                    delta = abs(state.put_greeks.get("delta", -0.5))
            else:
                # Calculate greeks dynamically for non-active scrips option recommendations
                opt_greeks = calculate_option_greeks(price, atm_strike, signal == "BUY", vix=state.vix_value, days_to_expiry=state.greeks_days_to_expiry)
                opt_entry = opt_greeks.get("price", round(price * 0.008, 1))
                delta = abs(opt_greeks.get("delta", 0.5))
            
            # Calculate Option-level stop loss and take profit dynamically using the option's delta
            option_risk = index_risk * delta
            option_reward = (2.5 * atr) * delta
            
            opt_sl = round(opt_entry - option_risk, 1)
            opt_sl = max(round(opt_entry * 0.1, 1), opt_sl)  # Max loss capped at 90% of premium
            opt_tp = round(opt_entry + option_reward, 1)
            
            ui_log("=========================================")
            ui_log(f"📢 [OPTION SIGNAL] {'🚀 BULLISH' if signal == 'BUY' else '🐻 BEARISH'} on {scrip.split('|')[-1].strip()}")
            ui_log(f"👉 CONTRACT: BUY {option_name} ({option_type})")
            ui_log(f"🎯 LIVE PREMIUM ENTRY:  ₹{opt_entry:.1f} (Index Spot: ₹{price:.2f})")
            ui_log(f"🎯 PREMIUM TARGET: ₹{opt_tp:.1f} (Index Spot: ₹{spot_tp:.2f})")
            ui_log(f"🛡️ PREMIUM STOPLOSS: ₹{opt_sl:.1f} (Index Spot: ₹{spot_sl:.2f})")
            ui_log(f"📊 OPTION RISK-REWARD: 1 : 1.67 (1.5x ATR SL, 2.5x ATR TP) | Delta: {delta:.2f}")
            ui_log(f"📋 CHECKLIST SCORE: {active_candle.get('checklist_score', 0)}/7 Conditions Met")
            ui_log("=========================================")
            
            days_ahead = 3 - timestamp.weekday()
            if days_ahead < 0:
                days_ahead += 7
            expiry_date = timestamp + timedelta(days=days_ahead)

            signal_data = {
                "time": timestamp.strftime("%H:%M:%S"),
                "date": timestamp.strftime("%Y-%m-%d"),
                "timestamp": int(timestamp.timestamp()),
                "expiry": expiry_date.strftime("%d-%b-%Y"),
                "source": "SIMULATION" if state.mode == "MOCK" else "LIVE",
                "signal_type": "BULLISH" if signal == "BUY" else "BEARISH",
                "contract_name": option_name,
                "option_type": option_type,
                "spot_price": float(round(price, 2)),
                "spot_sl": float(round(spot_sl, 2)),
                "spot_tp": float(round(spot_tp, 2)),
                "opt_entry": float(opt_entry),
                "opt_sl": float(opt_sl),
                "opt_tp": float(opt_tp),
                "atr": float(round(atr, 2)),
                "checklist_score": int(active_candle.get("checklist_score", 0)),
                "checklist_details": active_candle.get("checklist_details", {})
            }
            state.signals_history.append(signal_data)
            if len(state.signals_history) > 100:
                state.signals_history.pop(0)
            state.save_signals_to_file()
            
            # Broadcast structured options signal to frontend
            loop = asyncio.get_event_loop()
            asyncio.run_coroutine_threadsafe(
                broadcast_payload({
                    "type": "OPTION_SIGNAL",
                    "data": signal_data
                }),
                loop
            )
            
            # Send Telegram Alert
            action_text = "🟢 BUY CALL (CE)" if signal_data["signal_type"] == "BULLISH" else "🔴 BUY PUT (PE)"
            tg_message = (
                f"🦁 <b>LEO vwap option Alert!</b>\n"
                f"----------------------------------------\n"
                f"<b>Asset:</b> {scrip.split('|')[-1].strip()}\n"
                f"<b>Signal:</b> {action_text}\n"
                f"<b>Contract:</b> {signal_data['contract_name']}\n\n"
                f"<b>Est. Entry:</b> ₹{signal_data['opt_entry']:.1f}\n"
                f"<b>Target (TP):</b> ₹{signal_data['opt_tp']:.1f}\n"
                f"<b>Stop Loss (SL):</b> ₹{signal_data['opt_sl']:.1f}\n"
                f"<b>Checklist Score:</b> {signal_data['checklist_score']}/7 Met\n"
                f"<b>Time:</b> {signal_data['time']}\n"
            )
            send_telegram_notification(tg_message)
                
        # Auto-Trading Execution
        if signal in ["BUY", "SELL"] and state.auto_trade:
            ui_log(f"⚡ STRATEGY TRIGGERED {signal} SIGNAL for {scrip}")
            
            # Check current position
            pos = state.sim_broker.get_position(scrip)
            current_qty = pos["qty"]
            
            # Simple rules:
            # - On BUY: Close short (if any) and open long
            # - On SELL: Close long (if any) and open short
            # Target qty is state.qty
            
            order_side = None
            order_qty = 0
            
            if signal == "BUY":
                if current_qty < 0: # Short exists
                    order_side = "BUY"
                    order_qty = abs(current_qty) + state.qty # Reverse to long
                elif current_qty == 0:
                    order_side = "BUY"
                    order_qty = state.qty
            elif signal == "SELL":
                if current_qty > 0: # Long exists
                    order_side = "SELL"
                    order_qty = current_qty + state.qty # Reverse to short
                elif current_qty == 0:
                    order_side = "SELL"
                    order_qty = state.qty
                    
            if order_side and order_qty > 0:
                # CALCULATE ATR-BASED OPTION BUYING RISK (1.5x ATR SL, 2.5x ATR TP)
                atr = active_candle.get("atr14", price * 0.002)
                index_risk = max(1.5 * atr, price * 0.002)
                
                stop_loss = 0.0
                take_profit = 0.0
                
                if order_side == "BUY":
                    stop_loss = price - index_risk
                    take_profit = price + (2.5 * atr)
                else: # SELL / SHORT
                    stop_loss = price + index_risk
                    take_profit = price - (2.5 * atr)
                    
                stop_loss = round(stop_loss, 2)
                take_profit = round(take_profit, 2)
                
                order_rec = state.sim_broker.execute_order(
                    scrip=scrip,
                    side=order_side,
                    qty=order_qty,
                    price=price,
                    timestamp=timestamp,
                    stop_loss=stop_loss,
                    take_profit=take_profit
                )
                if order_rec:
                    ui_log(f"🛒 AUTO ORDER EXECUTED: {order_side} {order_qty} {scrip} @ {price:.2f}")
                    ui_log(f"🛡️ TARGET SET: Stop Loss @ ₹{stop_loss:.2f} | Take Profit (1:1.67) @ ₹{take_profit:.2f}")
                    # Broadcast updated order log & metrics
                    await broadcast_payload({
                        "type": "ORDER_EXECUTED",
                        "data": order_rec
                    })

    # CHECK FOR ACTIVE TARGET STOPS ON EVERY SINGLE TICK FOR ALL SCRIPS!
    for active_scrip_name, target in list(state.sim_broker.active_targets.items()):
        if active_scrip_name == scrip:
            pos = state.sim_broker.get_position(active_scrip_name)
            current_qty = pos["qty"]
            if current_qty != 0:
                # Update trailing stop loss dynamically using ATR-based trail
                atr = active_candle.get("atr14", price * 0.002) if active_candle else (price * 0.002)
                adx = active_candle.get("adx14", 20.0) if active_candle else 20.0
                trail_factor = 2.0 if adx > 30.0 else 2.5
                
                if current_qty > 0: # Long position
                    target["highest_price"] = max(target.get("highest_price", target.get("entry_price", price)), price)
                    trail_sl = target["highest_price"] - trail_factor * atr
                    target["stop_loss"] = max(target["stop_loss"], trail_sl)
                elif current_qty < 0: # Short position
                    target["lowest_price"] = min(target.get("lowest_price", target.get("entry_price", price)), price)
                    trail_sl = target["lowest_price"] + trail_factor * atr
                    target["stop_loss"] = min(target["stop_loss"], trail_sl)

                sl = target["stop_loss"]
                tp = target["take_profit"]
                
                is_exit = False
                exit_price = price
                exit_reason = ""
                
                if current_qty > 0: # Long position
                    if price <= sl:
                        is_exit = True
                        exit_price = sl
                        exit_reason = "STOP LOSS TRIGGERED"
                    elif price >= tp:
                        is_exit = True
                        exit_price = tp
                        exit_reason = "TAKE PROFIT (1:1.67)"
                elif current_qty < 0: # Short position
                    if price >= sl:
                        is_exit = True
                        exit_price = sl
                        exit_reason = "STOP LOSS TRIGGERED"
                    elif price <= tp:
                        is_exit = True
                        exit_price = tp
                        exit_reason = "TAKE PROFIT (1:1.67)"
                        
                if is_exit:
                    exit_side = "SELL" if current_qty > 0 else "BUY"
                    ui_log(f"🎯 TARGET REACHED: {exit_reason} at ₹{exit_price:.2f} for {active_scrip_name}!")
                    order_rec = state.sim_broker.execute_order(
                        scrip=active_scrip_name,
                        side=exit_side,
                        qty=abs(current_qty),
                        price=exit_price,
                        timestamp=timestamp
                    )
                    if order_rec:
                        await broadcast_payload({
                            "type": "ORDER_EXECUTED",
                            "data": order_rec
                        })
                        
    # Update running ticker prices to compute active simulated net asset value (NAV)
    current_prices = {scrip: price}
    # For simulation, fetch newest price from mock generator or client
    if state.mode == "MOCK":
        current_prices.update(state.mock_feed.state)
    else:
        # In Shoonya, we get latest prices from active states
        current_prices[scrip] = price
        
    metrics = state.sim_broker.get_metrics_payload(current_prices)
    
    # Calculate safety alert for active position or active market scrip
    if scrip == state.active_scrip:
        safety_alert = None
        close_price = price
        vwap_val = active_candle.get("vwap", 0.0)
        ema9_val = active_candle.get("ema9", 0.0)
        ema21_val = active_candle.get("ema21", 0.0)
        rsi_val = active_candle.get("rsi14", 50.0)
        
        active_qty = metrics.get("active_qty", 0)
        active_scrip = metrics.get("active_scrip")
        
        if active_qty != 0 and active_scrip == scrip:
            # We hold a position in this active scrip!
            warnings = []
            status = "NORMAL"
            
            if active_qty > 0: # LONG position (CE/Call)
                if vwap_val > 0.0 and close_price < vwap_val:
                    warnings.append("Price fell below VWAP (Bearish trend crossover)")
                if ema9_val > 0.0 and close_price < ema9_val:
                    warnings.append("Price fell below 9 EMA (Short-term trend reversal)")
                if ema21_val > 0.0 and close_price < ema21_val:
                    warnings.append("Price fell below 21 EMA (Medium-term trend reversal)")
                if rsi_val < 45.0:
                    warnings.append(f"RSI is {rsi_val:.1f} (< 45 indicates weak bullish momentum)")
                if potential_signal == "SELL":
                    warnings.append("🚨 STRATEGY DETECTED BEARISH REVERSAL SIGNALS!")
                    status = "CRITICAL"
                elif warnings:
                    status = "WARNING"
                    
                action = "Close CE position or tighten Stop Loss" if status != "NORMAL" else "Hold CE position (Trend is strong)"
            else: # SHORT position (PE/Put)
                if vwap_val > 0.0 and close_price > vwap_val:
                    warnings.append("Price rose above VWAP (Bullish trend crossover)")
                if ema9_val > 0.0 and close_price > ema9_val:
                    warnings.append("Price rose above 9 EMA (Short-term trend reversal)")
                if ema21_val > 0.0 and close_price > ema21_val:
                    warnings.append("Price rose above 21 EMA (Medium-term trend reversal)")
                if rsi_val > 55.0:
                    warnings.append(f"RSI is {rsi_val:.1f} (> 55 indicates weak bearish momentum)")
                if potential_signal == "BUY":
                    warnings.append("🚨 STRATEGY DETECTED BULLISH REVERSAL SIGNALS!")
                    status = "CRITICAL"
                elif warnings:
                    status = "WARNING"
                    
                action = "Close PE position or tighten Stop Loss" if status != "NORMAL" else "Hold PE position (Trend is strong)"
                
            safety_alert = {
                "type": "POSITION",
                "status": status,
                "warnings": warnings,
                "action": action
            }
        else:
            # FLAT position: calculate general trend / entry safety for this active scrip
            warnings = []
            status = "NORMAL"
            
            # Determine overall trend direction
            trend = "NEUTRAL"
            if vwap_val > 0.0 and ema9_val > 0.0 and ema21_val > 0.0:
                if close_price > vwap_val and ema9_val > ema21_val and close_price > ema9_val:
                    trend = "BULLISH"
                elif close_price < vwap_val and ema9_val < ema21_val and close_price < ema9_val:
                    trend = "BEARISH"
                    
            # Add general entry risk warnings
            if trend == "BULLISH" and rsi_val > 70.0:
                warnings.append("CE Entry Risk: Market is overbought (RSI > 70)")
                status = "WARNING"
            elif trend == "BEARISH" and rsi_val < 30.0:
                warnings.append("PE Entry Risk: Market is oversold (RSI < 30)")
                status = "WARNING"
                
            # Check for high VIX volatility
            if state.vix_value > 22.0:
                warnings.append(f"India VIX is {state.vix_value} (safety limit is 22.0)")
                status = "WARNING"
                
            if trend == "BULLISH":
                action = "Trend is Bullish. Look for Call (CE) entries on pullbacks near VWAP/EMA."
            elif trend == "BEARISH":
                action = "Trend is Bearish. Look for Put (PE) entries on rallies near VWAP/EMA."
            else:
                action = "Trend is Neutral/Choppy. Recommend waiting for a clear breakout."
                
            safety_alert = {
                "type": "MARKET",
                "status": status,
                "trend": trend,
                "warnings": warnings,
                "action": action,
                "metrics": {
                    "price": round(close_price, 2),
                    "vwap": round(vwap_val, 2),
                    "rsi": round(rsi_val, 1),
                    "ema9": round(ema9_val, 2),
                    "ema21": round(ema21_val, 2)
                }
            }
        state.active_safety_alert = safety_alert
        
    metrics["safety_alert"] = state.active_safety_alert
    
    await broadcast_payload({
        "type": "METRICS_UPDATE",
        "data": metrics
    })

# Feed worker task
async def feed_worker():
    try:
        if state.mode == "MOCK":
            ui_log(f"Starting simulated mock market data feed for {state.active_scrip}...")
            await state.mock_feed.generate_ticks(state.active_scrip, handle_incoming_tick)
        elif state.mode == "FYERS":
            ui_log(f"Starting live Fyers Broker market data feed for {state.active_scrip}...")
            success, msg = state.fyers.start_feed(handle_incoming_tick, ui_log)
            if not success:
                ui_log(f"❌ Error starting Fyers feed: {msg}")
                # Revert to MOCK
                state.mode = "MOCK"
                ui_log("Reverting to Mock data mode.")
                asyncio.create_task(restart_feed())
                return
                
            state.fyers.subscribe(state.active_scrip)
            
            # Keep task alive
            while True:
                await asyncio.sleep(1)
        else:
            ui_log(f"Starting live Shoonya Broker market data feed...")
            success, msg = state.shoonya.start_feed(handle_incoming_tick, ui_log)
            if not success:
                ui_log(f"❌ Error starting Shoonya feed: {msg}")
                # Revert to MOCK
                state.mode = "MOCK"
                ui_log("Reverting to Mock data mode.")
                asyncio.create_task(restart_feed())
                return
                
            state.shoonya.subscribe(state.active_scrip)
            
            # Keep task alive
            while True:
                await asyncio.sleep(1)
                
    except asyncio.CancelledError:
        ui_log("Market data feed task stopped.")
    except Exception as e:
        ui_log(f"❌ Error in feed worker: {e}")

async def stop_feed():
    if state.feed_task:
        state.feed_task.cancel()
        try:
            await state.feed_task
        except asyncio.CancelledError:
            pass
        state.feed_task = None
        
    if state.mode == "MOCK":
        state.mock_feed.stop()
    elif state.mode == "FYERS":
        state.fyers.stop()
        state.last_cumulative_volumes.clear()
    else:
        state.shoonya.stop()
        state.last_cumulative_volumes.clear()

async def restart_feed():
    await stop_feed()
    
    # Reset strategy calculations for all scrips
    state.reset_strategies()
    state.last_cumulative_volumes.clear()
    
    # Reset Option Premium and Greeks state
    state.active_strike = None
    state.call_builder = OptionCandleBuilder(state.interval_minutes)
    state.put_builder = OptionCandleBuilder(state.interval_minutes)
    state.call_greeks = {"price": 0.0, "delta": 0.0, "theta": 0.0, "gamma": 0.0, "vega": 0.0}
    state.put_greeks = {"price": 0.0, "delta": 0.0, "theta": 0.0, "gamma": 0.0, "vega": 0.0}
    
    # --- PRE-POPULATE/WARM UP STRATEGY BEFORE FEED START ---
    if state.mode == "MOCK":
        try:
            ui_log(f"Pre-populating mock historical candles for {state.active_scrip}...")
            historical_candles = state.mock_feed.generate_historical_candles(state.active_scrip, count=150)
            if historical_candles and len(historical_candles) > 0:
                for c in historical_candles:
                    state.strategy.process_tick(c["time"], c["close"], c["volume"])
                ui_log(f"Mock strategy warmed up with {len(historical_candles)} candles!")
        except Exception as e:
            ui_log(f"⚠️ Warning warming up mock history: {e}")
            
    elif state.mode == "FYERS" and state.fyers.authenticated and state.fyers.api:
        try:
            historical_candles = state.fyers.get_historical_candles(state.active_scrip, state.interval_minutes)
            if historical_candles and len(historical_candles) > 0:
                ui_log(f"Pre-populating {len(historical_candles)} historical candles from Fyers...")
                for c in historical_candles:
                    state.strategy.process_tick(c["time"], c["close"], c["volume"])
                ui_log("VWAP strategy calculations warmed up with real Fyers history!")
        except Exception as e:
            ui_log(f"⚠️ Warning warming up Fyers history: {e}")

    # Build options premium historical candles based on index warmup close prices
    if len(state.strategy.candles) > 0:
        try:
            last_c = state.strategy.candles[-1]
            if "NIFTY 50" in state.active_scrip or "FIN SERVICE" in state.active_scrip:
                strike_interval = 50
            else:
                strike_interval = 100
            state.active_strike = int(round(last_c["close"] / strike_interval) * strike_interval)
            
            # Populate option builders for Call/Put historical bars
            for c in state.strategy.candles:
                t = c["time"]
                call_data = calculate_option_greeks(c["close"], state.active_strike, True, vix=state.vix_value, days_to_expiry=state.greeks_days_to_expiry)
                put_data = calculate_option_greeks(c["close"], state.active_strike, False, vix=state.vix_value, days_to_expiry=state.greeks_days_to_expiry)
                state.call_builder.process_tick(t, call_data["price"], c["volume"] * 0.1)
                state.put_builder.process_tick(t, put_data["price"], c["volume"] * 0.1)
            
            # Setup current spot active Greeks
            state.call_greeks = call_data
            state.put_greeks = put_data
            ui_log(f"🎯 ATM Option Strike established at {state.active_strike} with option history populated.")
        except Exception as e:
            ui_log(f"⚠️ Error warming up option chains: {e}")
            
    # Restart the background task
    state.feed_task = asyncio.create_task(feed_worker())

# Startup event
@app.on_event("startup")
async def startup_event():
    ui_log("🚀 VWAP Strategy Application backend server started.")
    # Run the default mock feed on startup
    state.feed_task = asyncio.create_task(feed_worker())

@app.on_event("shutdown")
async def shutdown_event():
    await stop_feed()

# Pydantic model for Fyers login
class FyersLoginModel(BaseModel):
    client_id: str
    secret_key: str
    redirect_uri: str
    auth_code: str

# REST Endpoints
@app.get("/api/telegram")
def get_telegram_config():
    return {
        "telegram_token": state.telegram_token,
        "telegram_chat_id": state.telegram_chat_id,
        "telegram_enabled": state.telegram_enabled
    }

@app.post("/api/telegram")
def save_telegram_config(config: TelegramConfigModel):
    state.telegram_token = config.telegram_token
    state.telegram_chat_id = config.telegram_chat_id
    state.telegram_enabled = config.telegram_enabled
    state.save_telegram_config()
    ui_log(f"Telegram Settings updated: Enabled={state.telegram_enabled}")
    return {"status": "success"}

@app.get("/api/config")
def get_config():
    return {
        "mode": state.mode,
        "active_scrip": state.active_scrip,
        "interval_minutes": state.interval_minutes,
        "num_std": state.num_std,
        "qty": state.qty,
        "auto_trade": state.auto_trade,
        "vix_value": state.vix_value,
        "days_to_expiry": state.greeks_days_to_expiry,
        "min_checklist_score": state.min_checklist_score,
        "shoonya_authenticated": state.shoonya.authenticated,
        "fyers_authenticated": state.fyers.authenticated,
        "available_scrips": list(SCRIPS.keys())
    }

@app.post("/api/config")
async def update_config(config: ConfigModel):
    mode_changed = state.mode != config.mode
    scrip_changed = state.active_scrip != config.active_scrip
    params_changed = (state.interval_minutes != config.interval_minutes or 
                      state.num_std != config.num_std or
                      state.min_checklist_score != config.min_checklist_score)
    vix_changed = state.vix_value != config.vix_value
    expiry_changed = state.greeks_days_to_expiry != config.days_to_expiry
                      
    state.mode = config.mode
    state.active_scrip = config.active_scrip
    state.interval_minutes = config.interval_minutes
    state.num_std = config.num_std
    state.qty = config.qty
    state.auto_trade = config.auto_trade
    state.vix_value = config.vix_value
    state.greeks_days_to_expiry = config.days_to_expiry
    state.min_checklist_score = config.min_checklist_score
    
    if scrip_changed:
        state.active_safety_alert = None
        
    ui_log(f"Config updated: Mode={state.mode}, Ticker={state.active_scrip}, Interval={state.interval_minutes}m, StdDev={state.num_std}, Qty={state.qty}, AutoTrade={state.auto_trade}, VIX={state.vix_value}, DaysToExpiry={state.greeks_days_to_expiry}, MinScore={state.min_checklist_score}")
    
    if mode_changed or scrip_changed or params_changed:
        ui_log("Restarting data engine to apply parameter/source changes...")
        await restart_feed()
        
        # Compute current prices dict
        from mock_feed import SCRIPS
        current_prices = {}
        for s in SCRIPS.keys():
            if state.mode == "MOCK":
                current_prices[s] = state.mock_feed.get_current_price(s)
            else:
                strat = state.strategies.get(s)
                if strat and len(strat.candles) > 0:
                    current_prices[s] = strat.candles[-1]["close"]
                else:
                    current_prices[s] = SCRIPS[s]["price"]
                    
        # Broadcast full historical payload reset to update frontend chart
        await broadcast_payload({
            "type": "HISTORY_RESET",
            "data": {
                "candles": state.strategy.get_history_payload(),
                "call_candles": state.call_builder.get_history_payload(),
                "put_candles": state.put_builder.get_history_payload(),
                "call_greeks": state.call_greeks,
                "put_greeks": state.put_greeks,
                "active_strike": state.active_strike,
                "signals_history": state.signals_history,
                "prices": current_prices
            }
        })
    else:
        # Just update strategy active params on the fly for all strategies
        for strat in state.strategies.values():
            strat.change_parameters(interval_minutes=state.interval_minutes, num_std=state.num_std, min_checklist_score=state.min_checklist_score)
        
        if vix_changed or expiry_changed:
            # Rebuild option candle history using updated VIX/Expiry and existing index candles
            if len(state.strategy.candles) > 0 and state.active_strike is not None and state.active_strike != 0:
                state.call_builder.reset()
                state.put_builder.reset()
                for c in state.strategy.candles:
                    t = c["time"] # datetime object
                    call_data = calculate_option_greeks(c["close"], state.active_strike, True, vix=state.vix_value, days_to_expiry=state.greeks_days_to_expiry)
                    put_data = calculate_option_greeks(c["close"], state.active_strike, False, vix=state.vix_value, days_to_expiry=state.greeks_days_to_expiry)
                    state.call_builder.process_tick(t, call_data["price"], c["volume"] * 0.1)
                    state.put_builder.process_tick(t, put_data["price"], c["volume"] * 0.1)
                
                # Update current active greeks
                if state.strategy.active_candle:
                    ac = state.strategy.active_candle
                    t = ac["time"]
                    call_data = calculate_option_greeks(ac["close"], state.active_strike, True, vix=state.vix_value, days_to_expiry=state.greeks_days_to_expiry)
                    put_data = calculate_option_greeks(ac["close"], state.active_strike, False, vix=state.vix_value, days_to_expiry=state.greeks_days_to_expiry)
                    state.call_greeks = call_data
                    state.put_greeks = put_data
                    state.call_builder.process_tick(t, call_data["price"], ac["volume"] * 0.1)
                    state.put_builder.process_tick(t, put_data["price"], ac["volume"] * 0.1)
                    
            # Broadcast the updated INITIAL_STATE to refresh the frontend chart and Greeks
            current_prices = {state.active_scrip: state.mock_feed.get_current_price(state.active_scrip)}
            await broadcast_payload({
                "type": "INITIAL_STATE",
                "data": {
                    "scrip": state.active_scrip,
                    "candles": state.strategy.get_history_payload(),
                    "call_candles": state.call_builder.get_history_payload(),
                    "put_candles": state.put_builder.get_history_payload(),
                    "call_greeks": state.call_greeks,
                    "put_greeks": state.put_greeks,
                    "active_strike": state.active_strike,
                    "orders": state.sim_broker.orders,
                    "signals_history": state.signals_history,
                    "metrics": state.sim_broker.get_metrics_payload(current_prices),
                    "logs": state.log_messages,
                    "config": {
                        "mode": state.mode,
                        "active_scrip": state.active_scrip,
                        "interval_minutes": state.interval_minutes,
                        "num_std": state.num_std,
                        "qty": state.qty,
                        "auto_trade": state.auto_trade,
                        "vix_value": state.vix_value,
                        "days_to_expiry": state.greeks_days_to_expiry,
                        "min_checklist_score": state.min_checklist_score,
                        "shoonya_authenticated": state.shoonya.authenticated,
                        "fyers_authenticated": state.fyers.authenticated
                    }
                }
            })
        
    return {"status": "success"}

@app.post("/api/shoonya/login")
def shoonya_login(creds: ShoonyaLoginModel):
    success, msg = state.shoonya.login(
        userid=creds.userid,
        password=creds.password,
        totp_secret=creds.totp_secret,
        api_key=creds.api_key,
        vendor_code=creds.vendor_code
    )
    if success:
        return {"status": "success", "message": "Successfully logged in to Shoonya."}
    else:
        raise HTTPException(status_code=400, detail=msg)

@app.get("/api/fyers/authurl")
def get_fyers_authurl(client_id: str, secret_key: str, redirect_uri: str):
    url = state.fyers.get_auth_url(client_id, secret_key, redirect_uri)
    if url.startswith("Error"):
        raise HTTPException(status_code=400, detail=url)
    return {"url": url}

@app.post("/api/fyers/login")
def fyers_login(creds: FyersLoginModel):
    success, msg = state.fyers.login(
        client_id=creds.client_id,
        secret_key=creds.secret_key,
        redirect_uri=creds.redirect_uri,
        auth_code=creds.auth_code
    )
    if success:
        return {"status": "success", "message": "Successfully logged in to Fyers."}
    else:
        raise HTTPException(status_code=400, detail=msg)

@app.get("/api/fyers/callback", response_class=HTMLResponse)
def fyers_callback(auth_code: str = None, code: str = None):
    from fastapi.responses import HTMLResponse
    code_val = auth_code or code or "No authorization code found"
    
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <title>Fyers Connected Successfully</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
        <style>
            :root {{
                --background: #030712;
                --card-bg: rgba(17, 24, 39, 0.7);
                --accent: #f59e0b;
                --text: #f3f4f6;
                --text-muted: #9ca3af;
                --border: rgba(255, 255, 255, 0.08);
            }}
            body {{
                background-color: var(--background);
                color: var(--text);
                font-family: 'Outfit', sans-serif;
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100vh;
                margin: 0;
                overflow: hidden;
            }}
            .glass-card {{
                background: var(--card-bg);
                backdrop-filter: blur(16px);
                border: 1px solid var(--border);
                border-radius: 20px;
                padding: 40px;
                max-width: 500px;
                width: 90%;
                text-align: center;
                box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1);
                animation: fadeIn 0.8s ease;
            }}
            h1 {{
                font-size: 2rem;
                margin-bottom: 10px;
                font-weight: 700;
                background: linear-gradient(135deg, #f59e0b, #d97706);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }}
            p {{
                color: var(--text-muted);
                font-size: 0.95rem;
                line-height: 1.6;
                margin-bottom: 30px;
            }}
            .code-container {{
                position: relative;
                margin-bottom: 30px;
            }}
            .code-box {{
                background: rgba(0, 0, 0, 0.4);
                border: 1px solid var(--border);
                border-radius: 12px;
                padding: 16px;
                font-family: monospace;
                font-size: 1.05rem;
                color: var(--accent);
                word-break: break-all;
                box-shadow: inset 0 2px 10px rgba(0,0,0,0.5);
                text-shadow: 0 0 8px rgba(245, 158, 11, 0.3);
            }}
            .btn-copy {{
                background: linear-gradient(135deg, var(--accent), #d97706);
                border: none;
                border-radius: 10px;
                color: white;
                padding: 14px 28px;
                font-size: 0.95rem;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
                box-shadow: 0 4px 15px rgba(245, 158, 11, 0.3);
                width: 100%;
            }}
            .btn-copy:hover {{
                transform: translateY(-2px);
                box-shadow: 0 6px 20px rgba(245, 158, 11, 0.5);
            }}
            .btn-copy:active {{
                transform: translateY(0);
            }}
            .success-icon {{
                font-size: 3.5rem;
                color: #10b981;
                margin-bottom: 20px;
                animation: scaleUp 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                text-shadow: 0 0 15px rgba(16, 185, 129, 0.4);
            }}
            @keyframes fadeIn {{
                from {{ opacity: 0; transform: translateY(20px); }}
                to {{ opacity: 1; transform: translateY(0); }}
            }}
            @keyframes scaleUp {{
                from {{ transform: scale(0.5); opacity: 0; }}
                to {{ transform: scale(1); opacity: 1; }}
            }}
            .toast {{
                position: absolute;
                bottom: -45px;
                left: 50%;
                transform: translateX(-50%) translateY(10px);
                background: #10b981;
                color: white;
                padding: 6px 16px;
                border-radius: 8px;
                font-size: 0.8rem;
                font-weight: 600;
                opacity: 0;
                visibility: hidden;
                transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
            }}
            .toast.show {{
                opacity: 1;
                visibility: visible;
                transform: translateX(-50%) translateY(0);
            }}
        </style>
    </head>
    <body>
        <div class="glass-card">
            <div class="success-icon">✓</div>
            <h1>Fyers Connected Successfully</h1>
            <p>Your authorization code has been generated. Click below to copy it, then return to the VWAP Quantum Trading Dashboard and paste it in Step 2.</p>
            
            <div class="code-container">
                <div class="code-box" id="codeBox">{code_val}</div>
                <div class="toast" id="toast">Copied to Clipboard!</div>
            </div>
            
            <button class="btn-copy" onclick="copyCode()">📋 Copy Authorization Code</button>
        </div>

        <script>
            function copyCode() {{
                const codeText = document.getElementById('codeBox').innerText.trim();
                navigator.clipboard.writeText(codeText).then(() => {{
                    const toast = document.getElementById('toast');
                    toast.classList.add('show');
                    setTimeout(() => {{
                        toast.classList.remove('show');
                    }}, 2500);
                }}).catch(err => {{
                    // Fallback select
                    const codeBox = document.getElementById('codeBox');
                    const range = document.createRange();
                    range.selectNodeContents(codeBox);
                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);
                    document.execCommand('copy');
                    
                    const toast = document.getElementById('toast');
                    toast.innerText = "Selected! Press Ctrl+C to copy";
                    toast.classList.add('show');
                    setTimeout(() => {{
                        toast.classList.remove('show');
                    }}, 2500);
                }});
            }}
        </script>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content)

def get_mock_option_chain():
    spot = state.strategy.active_candle.get("close", 23150.0) if state.strategy.active_candle else 23150.0
    if "NIFTY 50" in state.active_scrip or "FIN SERVICE" in state.active_scrip:
        strike_interval = 50
    else:
        strike_interval = 100
    atm_strike = int(round(spot / strike_interval) * strike_interval)
    
    options_chain = []
    for i in range(-5, 6):
        strike = atm_strike + i * strike_interval
        call_greeks = calculate_option_greeks(spot, strike, True, vix=state.vix_value, days_to_expiry=state.greeks_days_to_expiry)
        put_greeks = calculate_option_greeks(spot, strike, False, vix=state.vix_value, days_to_expiry=state.greeks_days_to_expiry)
        
        options_chain.append({
            "strike_price": float(strike),
            "option_type": "CE",
            "symbol": f"MOCK:{state.active_scrip.split('|')[-1].replace(' ', '')}26JUN{strike}CE",
            "ltp": call_greeks["price"],
            "oi": int(1000000 / (abs(i) + 1) + (strike % 7) * 100),
            "iv": float(state.vix_value + (i * 0.2)),
        })
        options_chain.append({
            "strike_price": float(strike),
            "option_type": "PE",
            "symbol": f"MOCK:{state.active_scrip.split('|')[-1].replace(' ', '')}26JUN{strike}PE",
            "ltp": put_greeks["price"],
            "oi": int(800000 / (abs(i) + 1) + (strike % 9) * 120),
            "iv": float(state.vix_value - (i * 0.15)),
        })
    return options_chain

@app.get("/api/fyers/option_chain")
def get_fyers_option_chain():
    spot_price = state.strategy.active_candle.get("close", 23150.0) if state.strategy.active_candle else 23150.0
    
    if not state.fyers.authenticated or not state.fyers.api:
        mock_chain = get_mock_option_chain()
        return {
            "status": "success",
            "mode": "MOCK",
            "spot_price": spot_price,
            "data": {
                "optionsChain": mock_chain
            }
        }
    
    try:
        fyers_sym = SYMBOL_MAP_UI_TO_FYERS.get(state.active_scrip, "NSE:NIFTY50-INDEX")
        data = {
            "symbol": fyers_sym,
            "strikecount": 10,
        }
        response = state.fyers.api.optionchain(data=data)
        if response and response.get("s") == "ok":
            return {
                "status": "success",
                "mode": "LIVE",
                "spot_price": spot_price,
                "data": response.get("data", {})
            }
        else:
            msg = response.get("message", "Unknown error") if response else "No response"
            mock_chain = get_mock_option_chain()
            return {
                "status": "success",
                "mode": "MOCK_FALLBACK",
                "message": f"Fyers API Error: {msg}. Falling back to theoretical chain.",
                "spot_price": spot_price,
                "data": {
                    "optionsChain": mock_chain
                }
            }
    except Exception as e:
        mock_chain = get_mock_option_chain()
        return {
            "status": "success",
            "mode": "MOCK_FALLBACK",
            "message": f"Exception: {str(e)}. Falling back to theoretical chain.",
            "spot_price": spot_price,
            "data": {
                "optionsChain": mock_chain
            }
        }

@app.post("/api/sim/reset")
def reset_simulation():
    state.sim_broker.reset()
    state.signals_history.clear()
    state.save_signals_to_file()
    ui_log("Simulated broker portfolio and order history reset.")
    return {"status": "success"}

@app.post("/api/sim/trigger_signal")
async def trigger_mock_signal(signal_type: str = "BULLISH"):
    # Generate a realistic mock signal for the active scrip
    price = 22350.0 if "NIFTY" in state.active_scrip else 73500.0
    atr = price * 0.002
    
    if state.strategy.active_candle:
        price = state.strategy.active_candle.get("close", price)
        atr = state.strategy.active_candle.get("atr14", atr)
        
    if "NIFTY 50" in state.active_scrip or "FIN SERVICE" in state.active_scrip:
        strike_interval = 50
    else:
        strike_interval = 100
    atm_strike = int(round(price / strike_interval) * strike_interval)
    
    # 1.5x ATR SL, 2.5x ATR TP
    index_risk = max(1.5 * atr, price * 0.002)
    
    if signal_type == "BULLISH":
        spot_sl = price - index_risk
        spot_tp = price + (2.5 * atr)
        option_type = "Call Option (CE)"
        option_name = f"{state.active_scrip.split('|')[-1].strip()} {atm_strike} CE"
        checklist_score = 5
        checklist_details = {
            "VWAP Position": True,
            "EMA Separation": True,
            "RSI Trend": True,
            "Volume Spike": False,
            "EMA Trend": True,
            "Green Candle": True,
            "VWAP Band Support": False
        }
    else:
        spot_sl = price + index_risk
        spot_tp = price - (2.5 * atr)
        option_type = "Put Option (PE)"
        option_name = f"{state.active_scrip.split('|')[-1].strip()} {atm_strike} PE"
        checklist_score = 6
        checklist_details = {
            "VWAP Position": True,
            "EMA Separation": True,
            "RSI Trend": True,
            "Volume Spike": True,
            "EMA Trend": True,
            "Red Candle": True,
            "VWAP Band Resistance": False
        }
        
    opt_entry = round(price * 0.008, 1)
    opt_sl = round(opt_entry - (index_risk * 0.5), 1)
    opt_sl = max(round(opt_entry * 0.1, 1), opt_sl)
    opt_tp = round(opt_entry + (2.5 * atr * 0.5), 1)
    
    ui_log(f"Simulating options signal: {signal_type} {option_name} | Score: {checklist_score}/7")
    
    payload = {
        "type": "OPTION_SIGNAL",
        "data": {
            "signal_type": signal_type,
            "contract_name": option_name,
            "option_type": option_type,
            "spot_price": float(round(price, 2)),
            "spot_sl": float(round(spot_sl, 2)),
            "spot_tp": float(round(spot_tp, 2)),
            "opt_entry": float(opt_entry),
            "opt_sl": float(opt_sl),
            "opt_tp": float(opt_tp),
            "atr": float(round(atr, 2)),
            "checklist_score": checklist_score,
            "checklist_details": checklist_details
        }
    }
    now = datetime.now()
    days_ahead = 3 - now.weekday()
    if days_ahead < 0:
        days_ahead += 7
    expiry_date = now + timedelta(days=days_ahead)

    payload["data"]["time"] = now.strftime("%H:%M:%S")
    payload["data"]["date"] = now.strftime("%Y-%m-%d")
    payload["data"]["timestamp"] = int(now.timestamp())
    payload["data"]["expiry"] = expiry_date.strftime("%d-%b-%Y")
    payload["data"]["source"] = "TEST"
    state.signals_history.append(payload["data"])
    if len(state.signals_history) > 100:
        state.signals_history.pop(0)
    state.save_signals_to_file()
    await broadcast_payload(payload)
    
    # Send Telegram alert for mock/test signals too
    action_text = "🟢 BUY CALL (CE)" if signal_type == "BULLISH" else "🔴 BUY PUT (PE)"
    tg_message = (
        f"🦁 <b>LEO vwap option (TEST)</b>\n"
        f"----------------------------------------\n"
        f"<b>Asset:</b> {state.active_scrip.split('|')[-1].strip()}\n"
        f"<b>Signal:</b> {action_text}\n"
        f"<b>Contract:</b> {option_name}\n\n"
        f"<b>Est. Entry:</b> ₹{opt_entry:.1f}\n"
        f"<b>Target (TP):</b> ₹{opt_tp:.1f}\n"
        f"<b>Stop Loss (SL):</b> ₹{opt_sl:.1f}\n"
        f"<b>Checklist Score:</b> {checklist_score}/7 Met\n"
    )
    send_telegram_notification(tg_message)
    
    return {"status": "success", "data": payload["data"]}


# Pydantic model for backtest parameters
class BacktestParams(BaseModel):
    days: int = 1
    playback_speed_ms: int = 40
    instantly: bool = False

# Replay task worker
async def backtest_replay_worker(candles_list: List[Dict[str, Any]], speed_ms: int, instantly: bool = False):
    original_auto_trade = state.auto_trade
    try:
        ui_log(f"🎬 Starting VWAP historical backtest replay ({len(candles_list)} candles)...")
        # Always run trades during historical backtests regardless of live auto-trade setting
        state.auto_trade = True
        
        # Reset strategy and broker for the backtest
        state.reset_strategies()
        state.sim_broker.reset()
        state.last_cumulative_volumes.clear()
        state.signals_history.clear()
        state.save_signals_to_file()
        
        # Reset Option Premium and Greeks state
        state.active_strike = None
        state.call_builder = OptionCandleBuilder(state.interval_minutes)
        state.put_builder = OptionCandleBuilder(state.interval_minutes)
        state.call_greeks = {"price": 0.0, "delta": 0.0, "theta": 0.0, "gamma": 0.0, "vega": 0.0}
        state.put_greeks = {"price": 0.0, "delta": 0.0, "theta": 0.0, "gamma": 0.0, "vega": 0.0}
        
        # Broadcast full reset to frontend
        await broadcast_payload({
            "type": "HISTORY_RESET",
            "data": {
                "candles": [],
                "call_candles": [],
                "put_candles": [],
                "call_greeks": {"price": 0.0, "delta": 0.0, "theta": 0.0, "gamma": 0.0, "vega": 0.0},
                "put_greeks": {"price": 0.0, "delta": 0.0, "theta": 0.0, "gamma": 0.0, "vega": 0.0},
                "active_strike": None,
                "signals_history": []
            }
        })
        
        count = 0
        if instantly:
            ui_log("⚡ Processing instantly in batch mode (bypassing delay for long-term calculations)...")
            # In instant mode, we run calculations synchronously in a fast loop without any sleeping
            for c in candles_list:
                # Establish strike price on first candle
                if state.active_strike is None or state.active_strike == 0:
                    if "NIFTY 50" in state.active_scrip or "FIN SERVICE" in state.active_scrip:
                        strike_interval = 50
                    else:
                        strike_interval = 100
                    state.active_strike = int(round(c["close"] / strike_interval) * strike_interval)
                    ui_log(f"🎯 ATM Option Strike established at {state.active_strike} for backtest")

                # Calculate Option Premium & Greeks
                call_data = calculate_option_greeks(c["close"], state.active_strike, True, vix=state.vix_value, days_to_expiry=state.greeks_days_to_expiry)
                put_data = calculate_option_greeks(c["close"], state.active_strike, False, vix=state.vix_value, days_to_expiry=state.greeks_days_to_expiry)
                
                state.call_greeks = call_data
                state.put_greeks = put_data
                
                # Update Option Builders
                state.call_builder.process_tick(c["time"], call_data["price"], c["volume"] * 0.1)
                state.put_builder.process_tick(c["time"], put_data["price"], c["volume"] * 0.1)

                tick = {
                    "scrip": state.active_scrip,
                    "price": c["close"],
                    "volume": c["volume"],
                    "timestamp": c["time"],
                    "is_cumulative_volume": False
                }
                # Process tick internally (does calculations and sim trade triggers)
                active_candle, new_candle_started = state.strategy.process_tick(c["time"], c["close"], c["volume"])
                
                # Check for Auto-Trades
                if active_candle and state.auto_trade:
                    signal = active_candle.get("signal", "HOLD")
                    if signal in ["BUY", "SELL"]:
                        pos = state.sim_broker.get_position(state.active_scrip)
                        current_qty = pos["qty"]
                        
                        order_side = None
                        order_qty = 0
                        
                        if signal == "BUY":
                            if current_qty < 0:
                                order_side = "BUY"
                                order_qty = abs(current_qty) + state.qty
                            elif current_qty == 0:
                                order_side = "BUY"
                                order_qty = state.qty
                        elif signal == "SELL":
                            if current_qty > 0:
                                order_side = "SELL"
                                order_qty = current_qty + state.qty
                            elif current_qty == 0:
                                order_side = "SELL"
                                order_qty = state.qty
                                
                        if order_side and order_qty > 0:
                            lower_b = active_candle.get("lower_band", c["close"] * 0.99)
                            upper_b = active_candle.get("upper_band", c["close"] * 1.01)
                            
                            if order_side == "BUY":
                                risk = max(c["close"] - lower_b, c["close"] * 0.003)
                                stop_loss = c["close"] - risk
                                take_profit = c["close"] + (1.67 * risk)
                            else:
                                risk = max(upper_b - c["close"], c["close"] * 0.003)
                                stop_loss = c["close"] + risk
                                take_profit = c["close"] - (1.67 * risk)
                                
                            state.sim_broker.execute_order(
                                scrip=state.active_scrip,
                                side=order_side,
                                qty=order_qty,
                                price=c["close"],
                                timestamp=c["time"],
                                stop_loss=round(stop_loss, 2),
                                take_profit=round(take_profit, 2)
                            )
                            
                            # Calculate Option recommendations just like handle_incoming_tick
                            if "NIFTY 50" in state.active_scrip or "FIN SERVICE" in state.active_scrip:
                                strike_interval = 50
                            else:
                                strike_interval = 100
                            atm_strike_opt = int(round(c["close"] / strike_interval) * strike_interval)
                            
                            # Fetch ATR value
                            atr_opt = active_candle.get("atr14", c["close"] * 0.002)
                            
                            # Calculate ATR-based index-level SL/TP (1.5x ATR SL, 2.5x ATR TP)
                            index_risk_opt = max(1.5 * atr_opt, c["close"] * 0.002)
                            if signal == "BUY":
                                spot_sl_opt = c["close"] - index_risk_opt
                                spot_tp_opt = c["close"] + (2.5 * atr_opt)
                                option_type_opt = "Call Option (CE)"
                                option_name_opt = f"{state.active_scrip.split('|')[-1].strip()} {atm_strike_opt} CE"
                            else:
                                spot_sl_opt = c["close"] + index_risk_opt
                                spot_tp_opt = c["close"] - (2.5 * atr_opt)
                                option_type_opt = "Put Option (PE)"
                                option_name_opt = f"{state.active_scrip.split('|')[-1].strip()} {atm_strike_opt} PE"
                                
                            # Estimate options contract premium levels
                            opt_entry_opt = round(c["close"] * 0.008, 1)
                            opt_sl_opt = round(opt_entry_opt - (index_risk_opt * 0.5), 1)
                            opt_sl_opt = max(round(opt_entry_opt * 0.1, 1), opt_sl_opt)
                            opt_tp_opt = round(opt_entry_opt + (2.5 * atr_opt * 0.5), 1)
                            
                            # Date/Expiry calculations
                            timestamp_dt = c["time"]
                            days_ahead_opt = 3 - timestamp_dt.weekday()
                            if days_ahead_opt < 0:
                                days_ahead_opt += 7
                            expiry_date_opt = timestamp_dt + timedelta(days=days_ahead_opt)
                            
                            signal_data = {
                                "time": timestamp_dt.strftime("%H:%M:%S"),
                                "date": timestamp_dt.strftime("%Y-%m-%d"),
                                "timestamp": int(timestamp_dt.timestamp()),
                                "expiry": expiry_date_opt.strftime("%d-%b-%Y"),
                                "source": "BACKTEST",
                                "signal_type": "BULLISH" if signal == "BUY" else "BEARISH",
                                "contract_name": option_name_opt,
                                "option_type": option_type_opt,
                                "spot_price": float(round(c["close"], 2)),
                                "spot_sl": float(round(spot_sl_opt, 2)),
                                "spot_tp": float(round(spot_tp_opt, 2)),
                                "opt_entry": float(opt_entry_opt),
                                "opt_sl": float(opt_sl_opt),
                                "opt_tp": float(opt_tp_opt),
                                "atr": float(round(atr_opt, 2)),
                                "checklist_score": int(active_candle.get("checklist_score", 0)),
                                "checklist_details": active_candle.get("checklist_details", {})
                            }
                            state.signals_history.append(signal_data)
                            if len(state.signals_history) > 100:
                                state.signals_history.pop(0)
                
                # Check active target stops on every candle close
                pos = state.sim_broker.get_position(state.active_scrip)
                current_qty = pos["qty"]
                if current_qty != 0:
                    target = state.sim_broker.active_targets.get(state.active_scrip)
                    if target:
                        sl = target["stop_loss"]
                        tp = target["take_profit"]
                        is_exit = False
                        exit_price = c["close"]
                        
                        if current_qty > 0:
                            if c["low"] <= sl:
                                is_exit = True
                                exit_price = sl
                            elif c["high"] >= tp:
                                is_exit = True
                                exit_price = tp
                        elif current_qty < 0:
                            if c["high"] >= sl:
                                is_exit = True
                                exit_price = sl
                            elif c["low"] <= tp:
                                is_exit = True
                                exit_price = tp
                                
                        if is_exit:
                            exit_side = "SELL" if current_qty > 0 else "BUY"
                            state.sim_broker.execute_order(
                                scrip=state.active_scrip,
                                side=exit_side,
                                qty=abs(current_qty),
                                price=exit_price,
                                timestamp=c["time"]
                            )
            
            # Broadcast the complete historical state at the very end in one single payload
            metrics = state.sim_broker.get_metrics_payload({state.active_scrip: candles_list[-1]["close"]})
            await broadcast_payload({
                "type": "BACKTEST_COMPLETED",
                "data": {
                    "candles": state.strategy.get_history_payload(),
                    "call_candles": state.call_builder.get_history_payload(),
                    "put_candles": state.put_builder.get_history_payload(),
                    "call_greeks": state.call_greeks,
                    "put_greeks": state.put_greeks,
                    "active_strike": state.active_strike,
                    "orders": state.sim_broker.orders,
                    "metrics": metrics,
                    "signals_history": state.signals_history
                }
            })
        else:
            # Visual Replay Mode (Streams chronologically with delay)
            for c in candles_list:
                tick = {
                    "scrip": state.active_scrip,
                    "price": c["close"],
                    "volume": c["volume"],
                    "timestamp": c["time"],
                    "is_cumulative_volume": False,
                    "source": "BACKTEST"
                }
                await handle_incoming_tick(tick)
                count += 1
                if count % 40 == 0:
                    ui_log(f"Replayed {count}/{len(candles_list)} candles...")
                await asyncio.sleep(speed_ms / 1000.0)
            
            # Broadcast BACKTEST_COMPLETED at the end of visual replay mode as well
            metrics = state.sim_broker.get_metrics_payload({state.active_scrip: candles_list[-1]["close"]})
            await broadcast_payload({
                "type": "BACKTEST_COMPLETED",
                "data": {
                    "candles": state.strategy.get_history_payload(),
                    "call_candles": state.call_builder.get_history_payload(),
                    "put_candles": state.put_builder.get_history_payload(),
                    "call_greeks": state.call_greeks,
                    "put_greeks": state.put_greeks,
                    "active_strike": state.active_strike,
                    "orders": state.sim_broker.orders,
                    "metrics": metrics,
                    "signals_history": state.signals_history
                }
            })
            
        # Save signals to file upon backtest completion
        state.save_signals_to_file()
            
        # Compile final console report
        metrics = state.sim_broker.get_metrics_payload({state.active_scrip: candles_list[-1]["close"]})
        ui_log(f"✅ Historical Backtest Completed successfully!")
        ui_log(f"📊 Results: Win Rate: {metrics['win_rate']}% | Realized PnL: ₹{metrics['realized_pnl']:.2f} | Total Trades: {metrics['total_trades']}")
        
    except Exception as e:
        ui_log(f"❌ Error during backtest replay: {e}")
    finally:
        # Restore user's live auto-trade preference
        state.auto_trade = original_auto_trade
        # Automatically restart the live/mock feed so that it continues ticking
        ui_log("Returning to live mock market feed...")
        state.feed_task = asyncio.create_task(feed_worker())

@app.post("/api/backtest")
async def run_backtest(params: BacktestParams):
    # Stop the active feed task
    await stop_feed()
    
    # Retrieve historical data
    candles_to_replay = []
    
    # Handle long-term backtests (6 months = 180 days)
    is_long_term = params.days >= 30
    instantly = params.instantly or is_long_term
    
    if state.mode == "LIVE" and state.shoonya.authenticated:
        # For long term live history, we download larger candle intervals (e.g. 60 min)
        # to respect Shoonya API limits and keep calculations responsive.
        interval_str = "60" if is_long_term else str(state.interval_minutes)
        ui_log(f"Downloading historical candles from Shoonya REST API ({interval_str}m interval) for {state.active_scrip}...")
        try:
            # Resolve the active token
            from shoonya_client import POPULAR_SCRIPS
            scrip_info = POPULAR_SCRIPS.get(state.active_scrip)
            if not scrip_info:
                raise Exception(f"Unable to resolve exchange token for {state.active_scrip}")
                
            exchange = scrip_info["exchange"]
            token = scrip_info["token"]
            
            # Start time: e.g. start of N days ago
            from datetime import timedelta
            now = datetime.now()
            start_date = now - timedelta(days=params.days)
            start_epoch = int(start_date.replace(hour=9, minute=15, second=0).timestamp())
            
            # Fetch from Shoonya API
            raw_candles = state.shoonya.api.get_time_price_series(
                exchange=exchange,
                token=token,
                starttime=start_epoch,
                interval=interval_str
            )
            
            if not raw_candles or len(raw_candles) == 0:
                raise Exception("Shoonya REST API returned empty historical time-price series.")
                
            ui_log(f"Successfully downloaded {len(raw_candles)} candles from Shoonya. Parsing...")
            
            # Parse Shoonya format
            parsed = []
            for item in raw_candles:
                # sspt is the epoch timestamp
                epoch = int(item["sspt"])
                parsed.append({
                    "time": datetime.fromtimestamp(epoch),
                    "open": float(item["into"]),
                    "high": float(item["inth"]),
                    "low": float(item["intl"]),
                    "close": float(item["intc"]),
                    "volume": float(item["intv"])
                })
            
            # Sort chronologically (oldest first)
            parsed.sort(key=lambda x: x["time"])
            candles_to_replay = parsed
            
        except Exception as e:
            ui_log(f"❌ Failed to download live history: {e}. Reverting to Mock historical data.")
            # For 6 months, we generate ~1000 candles representing daily/hourly historical frames
            candle_count = 1500 if is_long_term else 375 * params.days
            candles_to_replay = state.mock_feed.generate_historical_candles(state.active_scrip, count=candle_count)
    elif state.mode == "FYERS" and state.fyers.authenticated:
        ui_log(f"Downloading historical candles from Fyers REST API for {state.active_scrip} ({params.days} days)...")
        try:
            candles_to_replay = state.fyers.get_backtest_candles(
                scrip=state.active_scrip,
                interval_minutes=state.interval_minutes,
                days=params.days
            )
            if not candles_to_replay or len(candles_to_replay) == 0:
                raise Exception("Fyers REST API returned empty historical candles list.")
        except Exception as e:
            ui_log(f"❌ Failed to download live Fyers history: {e}. Reverting to Mock historical data.")
            candle_count = 1500 if is_long_term else 375 * params.days
            candles_to_replay = state.mock_feed.generate_historical_candles(state.active_scrip, count=candle_count)
    else:
        # Mock Mode
        candle_count = 1500 if is_long_term else 375 * params.days
        ui_log(f"Generating realistic mock historical data ({params.days} day(s), {candle_count} candles)...")
        candles_to_replay = state.mock_feed.generate_historical_candles(state.active_scrip, count=candle_count)
        
    if len(candles_to_replay) == 0:
        # Fallback safeguard
        candle_count = 1500 if is_long_term else 375 * params.days
        candles_to_replay = state.mock_feed.generate_historical_candles(state.active_scrip, count=candle_count)
        
    # Start the replay worker task in the background
    state.feed_task = asyncio.create_task(
        backtest_replay_worker(candles_to_replay, params.playback_speed_ms, instantly=instantly)
    )
    
    return {"status": "success", "message": f"Backtest started for {len(candles_to_replay)} candles."}

@app.get("/api/history")
def get_chart_history():
    """
    Returns historical candles generated so far for the chart.
    """
    return {
        "scrip": state.active_scrip,
        "candles": state.strategy.get_history_payload(),
        "call_candles": state.call_builder.get_history_payload(),
        "put_candles": state.put_builder.get_history_payload(),
        "call_greeks": state.call_greeks,
        "put_greeks": state.put_greeks,
        "active_strike": state.active_strike,
        "metrics": state.sim_broker.get_metrics_payload(
            {state.active_scrip: state.mock_feed.get_current_price(state.active_scrip)}
        ),
        "orders": state.sim_broker.orders,
        "signals_history": state.signals_history,
        "logs": state.log_messages
    }

# WebSockets endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    state.websocket_connections.append(websocket)
    ui_log("Client connected via WebSocket.")
    
    # Send historical data immediately on connection so the chart populates instantly
    from mock_feed import SCRIPS
    current_prices = {}
    for s in SCRIPS.keys():
        if state.mode == "MOCK":
            current_prices[s] = state.mock_feed.get_current_price(s)
        else:
            strat = state.strategies.get(s)
            if strat and len(strat.candles) > 0:
                current_prices[s] = strat.candles[-1]["close"]
            else:
                current_prices[s] = SCRIPS[s]["price"]
                
    await websocket.send_text(json.dumps({
        "type": "INITIAL_STATE",
        "data": {
            "scrip": state.active_scrip,
            "candles": state.strategy.get_history_payload(),
            "call_candles": state.call_builder.get_history_payload(),
            "put_candles": state.put_builder.get_history_payload(),
            "call_greeks": state.call_greeks,
            "put_greeks": state.put_greeks,
            "active_strike": state.active_strike,
            "orders": state.sim_broker.orders,
            "signals_history": state.signals_history,
            "metrics": state.sim_broker.get_metrics_payload(current_prices),
            "logs": state.log_messages,
            "prices": current_prices,
            "config": {
                "mode": state.mode,
                "active_scrip": state.active_scrip,
                "interval_minutes": state.interval_minutes,
                "num_std": state.num_std,
                "qty": state.qty,
                "auto_trade": state.auto_trade,
                "vix_value": state.vix_value,
                "days_to_expiry": state.greeks_days_to_expiry,
                "min_checklist_score": state.min_checklist_score,
                "shoonya_authenticated": state.shoonya.authenticated,
                "fyers_authenticated": state.fyers.authenticated
            }
        }
    }))
    
    try:
        while True:
            # Keep connection alive and receive client manual actions
            data = await websocket.receive_text()
            payload = json.loads(data)
            action_type = payload.get("type")
            
            if action_type == "MANUAL_ORDER":
                # User clicked BUY/SELL manually in the interface
                side = payload.get("side")
                qty = payload.get("qty", state.qty)
                price = state.mock_feed.get_current_price(state.active_scrip)
                if state.mode == "LIVE" and state.shoonya.authenticated:
                    # Fetch latest price from Shoonya or fallback
                    pass
                    
                ui_log(f"📥 Received Manual Order Request: {side} {qty} shares of {state.active_scrip}")
                order_rec = state.sim_broker.execute_order(
                    scrip=state.active_scrip,
                    side=side,
                    qty=qty,
                    price=price,
                    timestamp=datetime.now()
                )
                
                if order_rec:
                    await broadcast_payload({
                        "type": "ORDER_EXECUTED",
                        "data": order_rec
                    })
                    
    except WebSocketDisconnect:
        logger.info("Client disconnected from WebSocket.")
        if websocket in state.websocket_connections:
            state.websocket_connections.remove(websocket)
    except Exception as e:
        logger.error(f"Error in websocket loop: {e}")
        if websocket in state.websocket_connections:
            state.websocket_connections.remove(websocket)

# ==========================================
# New Backtesting & Dhan Fetching Endpoints
# ==========================================
import glob
import os

class OfflineBacktestParams(BaseModel):
    csv_path: str
    scrip: str = "NSE|NIFTY 50"
    vix: float = 15.0
    qty: int = 100
    std: float = 2.0
    interval: int = 5
    min_checklist_score: int = 4

class DhanFetchParams(BaseModel):
    client_id: str
    access_token: str
    from_date: str
    to_date: str
    security_id: str = "13"
    segment: str = "IDX_I"
    instrument: str = "INDEX"
    output_name: str = "historical_nifty.csv"

@app.get("/api/backtest/csv_files")
def list_csv_files():
    """
    Lists all CSV files in the backend workspace directory.
    """
    try:
        backend_dir = os.path.dirname(__file__)
        csv_pattern = os.path.join(backend_dir, "*.csv")
        csv_files = glob.glob(csv_pattern)
        base_files = [os.path.basename(f) for f in csv_files]
        return {"status": "success", "files": base_files}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/backtest/run_offline")
def run_offline_backtest(params: OfflineBacktestParams):
    """
    Runs the offline backtest on a specified CSV file.
    """
    try:
        from backtest import OfflineBacktester
        
        backend_dir = os.path.dirname(__file__)
        full_csv_path = os.path.join(backend_dir, params.csv_path)
        
        if not os.path.exists(full_csv_path):
            raise HTTPException(status_code=404, detail=f"CSV file '{params.csv_path}' not found on server.")
            
        backtester = OfflineBacktester(vix_value=params.vix, qty=params.qty)
        results = backtester.run(
            csv_path=full_csv_path,
            scrip=params.scrip,
            num_std=params.std,
            interval_minutes=params.interval,
            min_checklist_score=params.min_checklist_score
        )
        
        return {"status": "success", "data": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/dhan/fetch_data")
def fetch_dhan_historical_data(params: DhanFetchParams):
    """
    Downloads historical data from Dhan and saves it as a CSV.
    """
    try:
        from fetch_dhan_data import fetch_and_save_data
        
        backend_dir = os.path.dirname(__file__)
        output_file_path = os.path.join(backend_dir, params.output_name)
        
        fetch_and_save_data(
            client_id=params.client_id,
            access_token=params.access_token,
            from_date=params.from_date,
            to_date=params.to_date,
            security_id=params.security_id,
            exchange_segment=params.segment,
            instrument_type=params.instrument,
            output_file=output_file_path
        )
        
        return {
            "status": "success", 
            "message": f"Historical data successfully saved to {params.output_name}",
            "filename": params.output_name
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
