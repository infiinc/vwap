import os
import pandas as pd
import numpy as np
from datetime import datetime, time
import json
import math
import uuid

from vwap_strategy import VWAPStrategy
from sim_broker import SimulatedBroker

def calculate_option_greeks(spot: float, strike: float, is_call: bool, vix: float = 15.0, days_to_expiry: float = 3.0):
    T = max(0.001, days_to_expiry / 365.0)
    r = 0.07 # 7% risk-free rate
    sigma = max(0.05, vix / 100.0) # Implied Volatility
    
    d1 = (math.log(spot / strike) + (r + 0.5 * sigma**2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    
    # Standard normal CDF approximation
    def norm_cdf(x):
        return (1.0 + math.erf(x / math.sqrt(2.0))) / 2.0
        
    nd1 = norm_cdf(d1)
    nd2 = norm_cdf(d2)
    
    if is_call:
        price = spot * nd1 - strike * math.exp(-r * T) * nd2
    else:
        price = strike * math.exp(-r * T) * norm_cdf(-d2) - spot * norm_cdf(-d1)
        
    return max(1.0, float(round(price, 2)))

def calculate_adx_series(df, period=14):
    high = df['high']
    low = df['low']
    close = df['close']
    
    high_diff = high.diff()
    low_diff = -low.diff()
    
    plus_dm = np.where((high_diff > low_diff) & (high_diff > 0), high_diff, 0.0)
    minus_dm = np.where((low_diff > high_diff) & (low_diff > 0), low_diff, 0.0)
    
    tr1 = high - low
    tr2 = (high - close.shift()).abs()
    tr3 = (low - close.shift()).abs()
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    
    alpha = 1.0 / period
    smoothed_tr = tr.ewm(alpha=alpha, adjust=False).mean()
    smoothed_plus_dm = pd.Series(plus_dm, index=df.index).ewm(alpha=alpha, adjust=False).mean()
    smoothed_minus_dm = pd.Series(minus_dm, index=df.index).ewm(alpha=alpha, adjust=False).mean()
    
    plus_di = 100.0 * (smoothed_plus_dm / (smoothed_tr + 1e-9))
    minus_di = 100.0 * (smoothed_minus_dm / (smoothed_tr + 1e-9))
    
    dx = 100.0 * ((plus_di - minus_di).abs() / (plus_di + minus_di + 1e-9))
    adx = dx.ewm(alpha=alpha, adjust=False).mean()
    
    return adx.fillna(20.0)

class OfflineBacktester:
    def __init__(self, initial_balance=100000.0, vix_value=15.0, qty=65):
        self.initial_balance = initial_balance
        self.vix_value = vix_value
        self.qty = qty
        
        self.broker = SimulatedBroker(initial_balance=initial_balance)
        
    def run(self, csv_path, scrip="NSE|NIFTY 50", interval_minutes=1, num_std=2.0, min_checklist_score=60):
        if not os.path.exists(csv_path):
            raise FileNotFoundError(f"Historical data CSV file not found at: {csv_path}")
            
        print(f"Loading historical data from {csv_path}...")
        df = pd.read_csv(csv_path)
        
        # Identify the datetime column
        time_col = None
        for col in ['timestamp', 'datetime', 'Time', 'Date', 'date']:
            if col in df.columns:
                time_col = col
                break
        if not time_col:
            raise KeyError("CSV must contain a column for date/time (e.g., 'timestamp' or 'datetime').")
            
        df[time_col] = pd.to_datetime(df[time_col])
        df = df.sort_values(by=time_col).reset_index(drop=True)
        
        header_map = {col.lower(): col for col in df.columns}
        required_cols = ['open', 'high', 'low', 'close', 'volume']
        for col in required_cols:
            if col not in header_map:
                raise KeyError(f"CSV must contain a '{col}' column (case-insensitive).")
        
        df = df.rename(columns={header_map[col]: col for col in required_cols})
        
        # Pre-calculate indicators
        print("Pre-calculating technical indicators...")
        df['ema9'] = df['close'].ewm(span=9, adjust=False).mean()
        df['ema21'] = df['close'].ewm(span=21, adjust=False).mean()
        df['ema50'] = df['close'].ewm(span=50, adjust=False).mean()
        df['ema200'] = df['close'].ewm(span=200, adjust=False).mean()
        
        delta = df['close'].diff()
        gain = delta.clip(lower=0)
        loss = -delta.clip(upper=0)
        avg_gain = gain.rolling(window=14, min_periods=1).mean()
        avg_loss = loss.rolling(window=14, min_periods=1).mean()
        rs = avg_gain / (avg_loss + 1e-9)
        df['rsi14'] = 100 - (100 / (1 + rs))
        df['rsi14'] = df['rsi14'].fillna(50)
        
        high_low = df['high'] - df['low']
        high_close = (df['high'] - df['close'].shift()).abs()
        low_close = (df['low'] - df['close'].shift()).abs()
        tr = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
        df['atr14'] = tr.rolling(window=14, min_periods=1).mean()
        df['atr14'] = df['atr14'].fillna(df['close'] * 0.002)
        
        df['atr_sma20'] = df['atr14'].rolling(window=20, min_periods=1).mean()
        df['atr_sma20'] = df['atr_sma20'].fillna(df['atr14'])
        
        df['vol_sma10'] = df['volume'].rolling(window=10, min_periods=1).mean()
        df['vol_sma10'] = df['vol_sma10'].fillna(df['volume'])
        df['vol_sma20'] = df['volume'].rolling(window=20, min_periods=1).mean()
        df['vol_sma20'] = df['vol_sma20'].fillna(df['volume'])
        
        df['adx14'] = calculate_adx_series(df)
        
        print(f"Loaded {len(df)} bars. Starting backtest...")
        
        strategy = VWAPStrategy(interval_minutes=interval_minutes, num_std=num_std, min_checklist_score=min_checklist_score)
        self.broker.reset()
        
        all_processed_candles = []
        
        # State variables for Daily Loss Limits
        current_date_str = None
        daily_loss_today = 0.0
        consecutive_losses_today = 0
        daily_loss_limit_hit = False
        
        for idx, row in df.iterrows():
            timestamp = row[time_col]
            open_price = float(row['open'])
            high_price = float(row['high'])
            low_price = float(row['low'])
            close_price = float(row['close'])
            volume = float(row['volume'])
            
            # Daily Reset Check for limits
            date_str = timestamp.strftime("%Y-%m-%d")
            if current_date_str != date_str:
                current_date_str = date_str
                daily_loss_today = 0.0
                consecutive_losses_today = 0
                daily_loss_limit_hit = False
                
            # 1. Evaluate Target Stops / Exits for Active Positions
            for active_scrip, target in list(self.broker.active_targets.items()):
                pos = self.broker.get_position(active_scrip)
                qty = pos["qty"]
                
                if qty != 0:
                    is_exit = False
                    exit_price = close_price
                    exit_reason = ""
                    exit_qty = 0
                    
                    # Update MFE / MAE Option prices at this candle
                    is_call = target["is_call"]
                    strike = target["option_strike"]
                    
                    best_spot = high_price if is_call else low_price
                    worst_spot = low_price if is_call else high_price
                    
                    best_opt = calculate_option_greeks(spot=best_spot, strike=strike, is_call=is_call, vix=self.vix_value)
                    worst_opt = calculate_option_greeks(spot=worst_spot, strike=strike, is_call=is_call, vix=self.vix_value)
                    
                    target["mfe"] = max(target["mfe"], best_opt)
                    target["mae"] = min(target["mae"], worst_opt)
                    
                    # Check Target 1 (Exit 25% of initial qty at 1 : 1.5 Risk-to-Reward)
                    if not target["target_1_hit"]:
                        t1_hit = False
                        if target["side"] == "BUY": # Long Spot
                            t1_hit = high_price >= target["target_1"]
                        else: # Short Spot
                            t1_hit = low_price <= target["target_1"]
                            
                        if t1_hit:
                            target["target_1_hit"] = True
                            exit_qty = round(0.25 * target["initial_qty"])
                            # Safety cap
                            exit_qty = min(exit_qty, abs(qty))
                            if exit_qty > 0:
                                opt_p = calculate_option_greeks(spot=target["target_1"], strike=strike, is_call=is_call, vix=self.vix_value)
                                order_rec = self.broker.execute_order(
                                    scrip=active_scrip,
                                    side="SELL" if target["side"] == "BUY" else "BUY",
                                    qty=exit_qty,
                                    price=target["target_1"],
                                    timestamp=timestamp,
                                    contract_name=target["contract_name"],
                                    option_price=opt_p,
                                    setup_type=target["setup_type"],
                                    trade_score=target["trade_score"],
                                    mfe=target["mfe"],
                                    mae=target["mae"]
                                )
                                print(f"[{timestamp}] [PARTIAL Target 1] exited {exit_qty} option contracts @ Rs. {opt_p:.2f}")
                                risk = target.get("index_risk", 10.0)
                                if target["side"] == "BUY":
                                    target["stop_loss"] = target["entry_price"] + 0.15 * risk
                                else:
                                    target["stop_loss"] = target["entry_price"] - 0.15 * risk
                                qty = pos["qty"] # update remaining
                                # Check daily loss sequence
                                if order_rec and order_rec["realized_pnl"] < 0:
                                    daily_loss_today += abs(order_rec["realized_pnl"])
                                    consecutive_losses_today += 1
                                elif order_rec and order_rec["realized_pnl"] > 0:
                                    consecutive_losses_today = 0
                                    
                    # Check Target 2 (Exit 50% of initial qty at opposite VWAP band)
                    # Dynamic opposite band value at this candle
                    upper_band = strategy.active_candle.get("upper_band", close_price) if strategy.active_candle else close_price
                    lower_band = strategy.active_candle.get("lower_band", close_price) if strategy.active_candle else close_price
                    
                    target_2_price = upper_band if target["side"] == "BUY" else lower_band
                    
                    if not target["target_2_hit"]:
                        t2_hit = False
                        if target["side"] == "BUY":
                            t2_hit = high_price >= target_2_price
                        else:
                            t2_hit = low_price <= target_2_price
                            
                        if t2_hit:
                            target["target_2_hit"] = True
                            exit_qty = round(0.50 * target["initial_qty"])
                            exit_qty = min(exit_qty, abs(qty))
                            if exit_qty > 0:
                                opt_p = calculate_option_greeks(spot=target_2_price, strike=strike, is_call=is_call, vix=self.vix_value)
                                order_rec = self.broker.execute_order(
                                    scrip=active_scrip,
                                    side="SELL" if target["side"] == "BUY" else "BUY",
                                    qty=exit_qty,
                                    price=target_2_price,
                                    timestamp=timestamp,
                                    contract_name=target["contract_name"],
                                    option_price=opt_p,
                                    setup_type=target["setup_type"],
                                    trade_score=target["trade_score"],
                                    mfe=target["mfe"],
                                    mae=target["mae"]
                                )
                                print(f"[{timestamp}] [PARTIAL Target 2] exited {exit_qty} option contracts @ Rs. {opt_p:.2f}")
                                qty = pos["qty"]
                                if order_rec and order_rec["realized_pnl"] < 0:
                                    daily_loss_today += abs(order_rec["realized_pnl"])
                                    consecutive_losses_today += 1
                                elif order_rec and order_rec["realized_pnl"] > 0:
                                    consecutive_losses_today = 0

                    # Check Trailing Stop Loss for the rest of position
                    sl_hit = False
                    if target["side"] == "BUY":
                        sl_hit = low_price <= target["stop_loss"]
                        exit_price = open_price if open_price < target["stop_loss"] else target["stop_loss"]
                    else:
                        sl_hit = high_price >= target["stop_loss"]
                        exit_price = open_price if open_price > target["stop_loss"] else target["stop_loss"]
                        
                    if sl_hit:
                        is_exit = True
                        exit_reason = "TRAILING STOP LOSS TRIGGERED"
                        
                    if is_exit and abs(qty) > 0:
                        opt_p = calculate_option_greeks(spot=exit_price, strike=strike, is_call=is_call, vix=self.vix_value)
                        
                        # Calculate Exit Quality 0-100
                        pnl_val = (opt_p - target["entry_option_price"]) if target["side"] == "BUY" else (target["entry_option_price"] - opt_p)
                        if pnl_val >= 0:
                            exit_quality = ((opt_p - target["entry_option_price"]) / (target["mfe"] - target["entry_option_price"] + 1e-9)) * 100
                        else:
                            exit_quality = (1.0 - (target["entry_option_price"] - opt_p) / (target["entry_option_price"] - target["mae"] + 1e-9)) * 100
                        exit_quality = max(0.0, min(100.0, float(round(exit_quality, 1))))
                        
                        order_rec = self.broker.execute_order(
                            scrip=active_scrip,
                            side="SELL" if target["side"] == "BUY" else "BUY",
                            qty=abs(qty),
                            price=exit_price,
                            timestamp=timestamp,
                            contract_name=target["contract_name"],
                            option_price=opt_p,
                            setup_type=target["setup_type"],
                            trade_score=target["trade_score"],
                            mfe=target["mfe"],
                            mae=target["mae"],
                            exit_quality=exit_quality
                        )
                        print(f"[{timestamp}] [EXIT] {exit_reason} for {active_scrip} at Rs. {exit_price:.2f} (Exit Quality: {exit_quality}%)")
                        if order_rec and order_rec["realized_pnl"] < 0:
                            daily_loss_today += abs(order_rec["realized_pnl"])
                            consecutive_losses_today += 1
                        elif order_rec and order_rec["realized_pnl"] > 0:
                            consecutive_losses_today = 0
                            
                        # Remove active target
                        if active_scrip in self.broker.active_targets:
                            del self.broker.active_targets[active_scrip]

                    # Update Adaptive trailing stop for the next candle if not exited
                    if not sl_hit:
                        atr = row['atr14']
                        adx = row['adx14']
                        trail_factor = 2.0 if adx > 30.0 else 2.5
                        
                        if target["side"] == "BUY":
                            # Trail from the highest high seen since entry
                            target["highest_price"] = max(target.get("highest_price", target["entry_price"]), high_price)
                            trail_sl = target["highest_price"] - trail_factor * atr
                            target["stop_loss"] = max(target["stop_loss"], trail_sl)
                        else:
                            # Trail from the lowest low seen since entry
                            target["lowest_price"] = min(target.get("lowest_price", target["entry_price"]), low_price)
                            trail_sl = target["lowest_price"] + trail_factor * atr
                            target["stop_loss"] = min(target["stop_loss"], trail_sl)

            # Check if Daily Loss Limits were exceeded
            if daily_loss_today >= 5000.0 or consecutive_losses_today >= 2:
                daily_loss_limit_hit = True

            # 2. Feed the bar to the strategy
            pos = self.broker.get_position(scrip)
            pos_qty = pos["qty"]

            active_candle, new_candle_started = strategy.process_tick(
                timestamp=timestamp,
                price=close_price,
                volume=volume,
                vix=self.vix_value,
                ema9=float(row['ema9']),
                ema21=float(row['ema21']),
                rsi14=float(row['rsi14']),
                atr14=float(row['atr14']),
                vol_sma10=float(row['vol_sma10']),
                ema50=float(row['ema50']),
                ema200=float(row['ema200']),
                adx14=float(row['adx14']),
                atr_sma20=float(row['atr_sma20']),
                vol_sma20=float(row['vol_sma20']),
                daily_loss_limit_hit=daily_loss_limit_hit,
                position_qty=pos_qty,
                open_price=open_price,
                high_price=high_price,
                low_price=low_price
            )
            
            if new_candle_started and len(strategy.candles) > 0:
                prev_finalized = strategy.candles[-1].copy()
                prev_finalized["time"] = prev_finalized["time"].strftime("%Y-%m-%d %H:%M:%S")
                all_processed_candles.append(prev_finalized)
            
            if active_candle:
                signal = active_candle.get("signal", "HOLD")
                
                # 3. Process new strategy signals
                if signal in ["BUY", "SELL"]:
                    pos = self.broker.get_position(scrip)
                    current_qty = pos["qty"]
                    
                    # Reversal check: if opposite position exists, close it first!
                    if (signal == "BUY" and current_qty < 0) or (signal == "SELL" and current_qty > 0):
                        opt_details = self.broker.active_targets.get(scrip)
                        contract_name = None
                        option_price = None
                        mfe = None
                        mae = None
                        if opt_details:
                            contract_name = opt_details["contract_name"]
                            option_price = calculate_option_greeks(
                                spot=close_price,
                                strike=opt_details["option_strike"],
                                is_call=opt_details["is_call"],
                                vix=self.vix_value
                            )
                            mfe = opt_details["mfe"]
                            mae = opt_details["mae"]
                            
                        self.broker.execute_order(
                            scrip=scrip,
                            side="BUY" if current_qty < 0 else "SELL",
                            qty=abs(current_qty),
                            price=close_price,
                            timestamp=timestamp,
                            contract_name=contract_name,
                            option_price=option_price,
                            mfe=mfe,
                            mae=mae
                        )
                        current_qty = 0
                        if scrip in self.broker.active_targets:
                            del self.broker.active_targets[scrip]
                        
                    # Open new position
                    if current_qty == 0:
                        order_side = "BUY" if signal == "BUY" else "SELL"
                        
                        # Determine strike
                        strike_interval = 50 if ("NIFTY 50" in scrip or "FIN SERVICE" in scrip) else 100
                        strike = int(round(close_price / strike_interval) * strike_interval)
                        is_call = (signal == "BUY")
                        
                        scrip_short_name = scrip.split('|')[-1].strip()
                        if "NIFTY 50" in scrip_short_name:
                            scrip_display_name = "NIFTY"
                        elif "NIFTY BANK" in scrip_short_name:
                            scrip_display_name = "BANKNIFTY"
                        elif "FIN SERVICE" in scrip_short_name:
                            scrip_display_name = "FINNIFTY"
                        else:
                            scrip_display_name = scrip_short_name
                            
                        contract_name = f"{scrip_display_name} {strike} CE" if is_call else f"{scrip_display_name} {strike} PE"
                        opt_price = calculate_option_greeks(spot=close_price, strike=strike, is_call=is_call, vix=self.vix_value)
                        
                        # Grading & Position size adjustment
                        multiplier = active_candle.get("position_multiplier", 1.0)
                        lots_qty = max(1, round(self.qty * multiplier))
                        
                        # Calculate stops: swing high/low of last 5 candles
                        swing_low = df.iloc[max(0, idx-5):idx+1]['low'].min()
                        swing_high = df.iloc[max(0, idx-5):idx+1]['high'].max()
                        
                        atr = row['atr14']
                        index_risk = max(2.0 * atr, close_price - swing_low if signal == "BUY" else swing_high - close_price)
                        
                        # Target 1 (R:R = 1 : 1.0)
                        # Target 2 (VWAP Band - dynamic, evaluated candle-by-candle)
                        if signal == "BUY":
                            stop_loss = close_price - index_risk
                            target_1 = close_price + 1.0 * index_risk
                        else:
                            stop_loss = close_price + index_risk
                            target_1 = close_price - 1.0 * index_risk
                            
                        stop_loss = round(stop_loss, 2)
                        target_1 = round(target_1, 2)
                        
                        # Register active target for tracking
                        self.broker.active_targets[scrip] = {
                            "initial_qty": lots_qty,
                            "qty_remaining": lots_qty,
                            "side": signal,
                            "entry_price": close_price,
                            "entry_option_price": opt_price,
                            "stop_loss": stop_loss,
                            "target_1": target_1,
                            "target_1_hit": False,
                            "target_2_hit": False,
                            "contract_name": contract_name,
                            "option_strike": strike,
                            "is_call": is_call,
                            "setup_type": active_candle.get("setup_type", "N/A"),
                            "trade_score": active_candle.get("checklist_score", 0),
                            "grade": active_candle.get("grade", "Skip"),
                            "entry_time": timestamp.strftime("%Y-%m-%d %H:%M:%S"),
                            "vix": self.vix_value,
                            "mfe": opt_price,
                            "mae": opt_price,
                            "index_risk": index_risk,
                            "highest_price": close_price,
                            "lowest_price": close_price
                        }
                        
                        self.broker.execute_order(
                            scrip=scrip,
                            side=order_side,
                            qty=lots_qty,
                            price=close_price,
                            timestamp=timestamp,
                            stop_loss=stop_loss,
                            take_profit=target_1,
                            contract_name=contract_name,
                            option_price=opt_price,
                            setup_type=active_candle.get("setup_type", "N/A"),
                            trade_score=active_candle.get("checklist_score", 0)
                        )
                        print(f"[{timestamp}] [SIGNAL] 3-STAGE TRIGGERED {signal} - Order: {order_side} {lots_qty} contracts @ {close_price:.2f} (SL: {stop_loss}, Target 1: {target_1})")
                        
        # 4. Generate & Display Metrics Report
        current_prices = {scrip: df.iloc[-1]['close']}
        metrics = self.broker.get_metrics_payload(current_prices)
        
        print("\n" + "="*50)
        print("                BACKTEST PERFORMANCE REPORT")
        print("="*50)
        print(f"Instrument:             {scrip}")
        print(f"Initial Balance:        Rs. {self.initial_balance:,.2f}")
        print(f"Ending Balance:         Rs. {metrics['balance']:,.2f}")
        print(f"Net Realized PnL:       Rs. {metrics['realized_pnl']:+,.2f}")
        print(f"Total Closed Trades:    {metrics['total_trades']}")
        print(f"Winning Trades:         {self.broker.winning_trades}")
        print(f"Losing Trades:          {metrics['total_trades'] - self.broker.winning_trades}")
        print(f"Win Rate:               {metrics['win_rate']}%")
        print(f"Maximum Drawdown:       {metrics['max_drawdown']}%")
        print(f"Gross Profit:           Rs. {metrics['gross_profit']:,.2f}")
        print(f"Gross Loss:             Rs. {metrics['gross_loss']:,.2f}")
        print("="*50)
        
        # Append the final active candle if present
        if active_candle:
            last_c = active_candle.copy()
            if strategy.active_candle:
                last_c = strategy.active_candle.copy()
                last_c["time"] = last_c["time"].strftime("%Y-%m-%d %H:%M:%S")
            all_processed_candles.append(last_c)
 
        # Save candle-wise indicator log
        candles_filepath = "backtest_candles.json"
        with open(candles_filepath, "w") as f:
            json.dump(all_processed_candles, f, indent=4)
        print(f"Candle-wise indicators saved to '{candles_filepath}'")
 
        # Save trade log
        log_filepath = "backtest_results.json"
        with open(log_filepath, "w") as f:
            json.dump({
                "metrics": metrics,
                "orders": self.broker.orders
            }, f, indent=4)
        print(f"Detailed trade logs saved to '{log_filepath}'")
        
        # Save skipped trades log
        skipped_filepath = "skipped_trades_log.json"
        with open(skipped_filepath, "w") as f:
            json.dump(strategy.skipped_trades, f, indent=4)
        print(f"Skipped trades log saved to '{skipped_filepath}'")
        
        # Save candle features dataset for ML
        try:
            feat_df = pd.DataFrame(strategy.candle_features)
            feat_filepath = "candle_features_dataset.csv"
            feat_df.to_csv(feat_filepath, index=False)
            print(f"AI candle features dataset saved to '{feat_filepath}'\n")
        except Exception as e:
            print(f"Error saving AI features: {e}\n")
            
        return {
            "metrics": metrics,
            "orders": self.broker.orders
        }

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="VWAP Strategy Offline Backtester")
    parser.add_argument("--csv", type=str, required=True, help="Path to the historical 1-minute data CSV file")
    parser.add_argument("--scrip", type=str, default="NSE|NIFTY 50", help="Scrip name (e.g. NSE|NIFTY 50)")
    parser.add_argument("--vix", type=float, default=15.0, help="India VIX level for filtering")
    parser.add_argument("--qty", type=int, default=65, help="Order trade quantity")
    parser.add_argument("--std", type=float, default=2.0, help="VWAP Band Standard Deviation multiplier")
    parser.add_argument("--score", type=int, default=60, help="Minimum checklist score threshold (e.g. 60, 70, 80)")
    
    args = parser.parse_args()
    
    backtester = OfflineBacktester(vix_value=args.vix, qty=args.qty)
    backtester.run(csv_path=args.csv, scrip=args.scrip, num_std=args.std, min_checklist_score=args.score)
