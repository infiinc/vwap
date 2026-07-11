import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import logging

logger = logging.getLogger("vwap_strategy")

class VWAPStrategy:
    def __init__(self, interval_minutes=1, num_std=2.0):
        self.interval_minutes = interval_minutes
        self.num_std = num_std
        
        # Historical candles list: each is a dict with keys:
        # 'time', 'open', 'high', 'low', 'close', 'volume', 'vwap', 'upper_band', 'lower_band', 'signal'
        self.candles = []
        
        # Active (current incomplete) candle
        self.active_candle = None
        
        # Running cumulative sums for the current day
        self.current_day_str = None
        self.cum_tp_v = 0.0     # Sum of (Typical Price * Volume)
        self.cum_v = 0.0        # Sum of Volume
        self.cum_tp2_v = 0.0    # Sum of (Typical Price^2 * Volume) for standard deviation
        
        # Keep track of last signal to avoid repeats
        self.last_signal = None
        
        # Checklist-Scored Strategy state
        self.trades_triggered_today = 0

    def reset_daily_totals(self, day_str):
        logger.info(f"Resetting daily VWAP totals for new day: {day_str}")
        self.current_day_str = day_str
        self.cum_tp_v = 0.0
        self.cum_v = 0.0
        self.cum_tp2_v = 0.0
        self.last_signal = None
        self.trades_triggered_today = 0

    def process_tick(self, timestamp: datetime, price: float, volume: float, vix: float = 15.0):
        """
        Processes a single price-volume tick.
        Updates the active candle, daily sums, calculates indicators, Checklist scores, and evaluates signals.
        """
        day_str = timestamp.strftime("%Y-%m-%d")
        
        # 1. Daily Reset Check
        if self.current_day_str != day_str:
            self.reset_daily_totals(day_str)
            
        # 2. Determine Candle Slot
        delta = timedelta(minutes=self.interval_minutes)
        aligned_ts = timestamp - timedelta(
            minutes=timestamp.minute % self.interval_minutes,
            seconds=timestamp.second,
            microseconds=timestamp.microsecond
        )
        
        new_candle_started = False
        
        # 3. Create or Update Candle
        if self.active_candle is None:
            self.active_candle = {
                "time": aligned_ts,
                "open": price,
                "high": price,
                "low": price,
                "close": price,
                "volume": volume,
                "tick_count": 1
            }
            new_candle_started = True
        elif self.active_candle["time"] != aligned_ts:
            # Finalize previous active candle
            finalized = self._finalize_active_candle()
            if finalized:
                self.candles.append(finalized)
                if len(self.candles) > 1000:
                    self.candles.pop(0)
            
            # Start new active candle
            self.active_candle = {
                "time": aligned_ts,
                "open": price,
                "high": price,
                "low": price,
                "close": price,
                "volume": volume,
                "tick_count": 1
            }
            new_candle_started = True
        else:
            self.active_candle["high"] = max(self.active_candle["high"], price)
            self.active_candle["low"] = min(self.active_candle["low"], price)
            self.active_candle["close"] = price
            self.active_candle["volume"] += volume
            self.active_candle["tick_count"] += 1

        # 4. Calculate live indicators for the active candle
        c = self.active_candle
        typical_price = (c["high"] + c["low"] + c["close"]) / 3.0
        v = c["volume"]
        
        temp_cum_tp_v = self.cum_tp_v + (typical_price * v)
        temp_cum_v = self.cum_v + v
        temp_cum_tp2_v = self.cum_tp2_v + ((typical_price ** 2) * v)
        
        vwap = 0.0
        std_dev = 0.0
        upper_band = 0.0
        lower_band = 0.0
        
        if temp_cum_v > 0:
            vwap = temp_cum_tp_v / temp_cum_v
            variance = (temp_cum_tp2_v / temp_cum_v) - (vwap ** 2)
            std_dev = np.sqrt(max(0.0, variance))
            upper_band = vwap + (self.num_std * std_dev)
            lower_band = vwap - (self.num_std * std_dev)

        c["vwap"] = float(round(vwap, 2))
        c["upper_band"] = float(round(upper_band, 2))
        c["lower_band"] = float(round(lower_band, 2))
        c["std_dev"] = float(round(std_dev, 2))
        
        # 4.5: Calculate advanced technical indicators using pandas
        temp_candles = []
        for cand in self.candles:
            temp_candles.append(cand.copy())
        
        c_copy = c.copy()
        c_copy["time"] = timestamp
        temp_candles.append(c_copy)
        
        df = pd.DataFrame(temp_candles)
        
        # Calculate 9 & 21 EMAs
        df['ema9'] = df['close'].ewm(span=9, adjust=False).mean()
        df['ema21'] = df['close'].ewm(span=21, adjust=False).mean()
        
        # Calculate RSI(14)
        delta = df['close'].diff()
        gain = delta.clip(lower=0)
        loss = -delta.clip(upper=0)
        avg_gain = gain.rolling(window=14, min_periods=1).mean()
        avg_loss = loss.rolling(window=14, min_periods=1).mean()
        rs = avg_gain / (avg_loss + 1e-9)
        df['rsi14'] = 100 - (100 / (1 + rs))
        df['rsi14'] = df['rsi14'].fillna(50)
        
        # Calculate ATR(14)
        high_low = df['high'] - df['low']
        high_close = (df['high'] - df['close'].shift()).abs()
        low_close = (df['low'] - df['close'].shift()).abs()
        tr = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
        df['atr14'] = tr.rolling(window=14, min_periods=1).mean()
        df['atr14'] = df['atr14'].fillna(price * 0.002)
        
        # Calculate Volume SMA(10)
        df['vol_sma10'] = df['volume'].rolling(window=10, min_periods=1).mean()
        df['vol_sma10'] = df['vol_sma10'].fillna(df['volume'])
        
        # Extract the indicators back to our active candle
        last_row = df.iloc[-1]
        c["ema9"] = float(round(last_row['ema9'], 2))
        c["ema21"] = float(round(last_row['ema21'], 2))
        c["rsi14"] = float(round(last_row['rsi14'], 2))
        c["atr14"] = float(round(last_row['atr14'], 2))
        c["vol_sma10"] = float(round(last_row['vol_sma10'], 2))
        
        # 5. Signal Evaluation
        signal = "HOLD"
        potential_signal = "HOLD"
        
        # Pre-requisite for checklist rebounds:
        has_prev = len(self.candles) > 0
        prev = self.candles[-1] if has_prev else None
        
        # Checklist conditions
        bull_conds = {
            "VWAP Position": bool(c["close"] > c["vwap"]),
            "EMA Separation": bool(c["ema9"] - c["ema21"] >= 0.0005 * c["close"]),
            "RSI Trend": bool(c["rsi14"] > 50),
            "Volume Spike": bool(c["volume"] >= 1.5 * c["vol_sma10"]),
            "EMA Trend": bool(c["close"] > c["ema9"]),
            "Green Candle": bool(c["close"] > c["open"]),
            "VWAP Band Support": bool(c["low"] <= c["lower_band"] or (has_prev and prev.get("low", 0.0) <= prev.get("lower_band", 0.0)))
        }
        
        bear_conds = {
            "VWAP Position": bool(c["close"] < c["vwap"]),
            "EMA Separation": bool(c["ema21"] - c["ema9"] >= 0.0005 * c["close"]),
            "RSI Trend": bool(c["rsi14"] < 50),
            "Volume Spike": bool(c["volume"] >= 1.5 * c["vol_sma10"]),
            "EMA Trend": bool(c["close"] < c["ema9"]),
            "Red Candle": bool(c["close"] < c["open"]),
            "VWAP Band Resistance": bool(c["high"] >= c["upper_band"] or (has_prev and prev.get("high", 0.0) >= prev.get("upper_band", 0.0)))
        }
        
        # Determine potential signal crossovers/bounces
        if has_prev:
            curr_close = c["close"]
            curr_vwap = c["vwap"]
            curr_lower = c["lower_band"]
            curr_upper = c["upper_band"]
            
            prev_close = prev["close"]
            prev_vwap = prev["vwap"]
            prev_lower = prev.get("lower_band", 0.0)
            prev_upper = prev.get("upper_band", 999999.0)
            
            # CE / Call Potential Trigger
            if (prev_close <= prev_vwap and curr_close > curr_vwap) or \
               (prev.get("low", prev_close) <= prev_lower and curr_close > curr_lower and curr_close < curr_vwap):
                potential_signal = "BUY"
            
            # PE / Put Potential Trigger
            elif (prev_close >= prev_vwap and curr_close < curr_vwap) or \
                 (prev.get("high", prev_close) >= prev_upper and curr_close < curr_upper and curr_close > curr_vwap):
                potential_signal = "SELL"
                
        # Evaluate scoring & filters
        bull_score = sum(1 for v in bull_conds.values() if v)
        bear_score = sum(1 for v in bear_conds.values() if v)
        
        # Filters state
        from datetime import time
        time_blocked = timestamp.time() > time(14, 30)
        vix_blocked = vix > 22.0
        trade_cap_blocked = self.trades_triggered_today >= 2
        rsi_blocked = False
        
        if potential_signal == "BUY":
            rsi_blocked = c["rsi14"] > 72
            c["checklist_score"] = bull_score
            c["checklist_details"] = bull_conds
            
            if bull_score >= 4 and not time_blocked and not vix_blocked and not trade_cap_blocked and not rsi_blocked:
                signal = "BUY"
                self.trades_triggered_today += 1
                logger.info(f"Checklist Strategy Triggered BUY signal (score {bull_score}/7). Trades today: {self.trades_triggered_today}")
            else:
                signal = "HOLD"
                
        elif potential_signal == "SELL":
            rsi_blocked = c["rsi14"] < 28
            c["checklist_score"] = bear_score
            c["checklist_details"] = bear_conds
            
            if bear_score >= 4 and not time_blocked and not vix_blocked and not trade_cap_blocked and not rsi_blocked:
                signal = "SELL"
                self.trades_triggered_today += 1
                logger.info(f"Checklist Strategy Triggered SELL signal (score {bear_score}/7). Trades today: {self.trades_triggered_today}")
            else:
                signal = "HOLD"
        else:
            # Default presentation values for ordinary ticks
            c["checklist_score"] = bull_score if c["close"] > c["vwap"] else bear_score
            c["checklist_details"] = bull_conds if c["close"] > c["vwap"] else bear_conds
            signal = "HOLD"
            
        c["signal"] = signal
        c["potential_signal"] = potential_signal
        c["time_blocked"] = time_blocked
        c["vix_blocked"] = vix_blocked
        c["trade_cap_blocked"] = trade_cap_blocked
        c["rsi_blocked"] = rsi_blocked
        
        # Avoid repeat signals in the same candle or consecutive candles of the same type
        if signal != "HOLD" and signal != self.last_signal:
            self.last_signal = signal
        else:
            c["signal"] = "HOLD"
            
        return self.get_active_candle_payload(), new_candle_started

    def _finalize_active_candle(self):
        """
        Permanently adds the active candle's typical price & volume to daily totals.
        """
        if self.active_candle is None:
            return None
            
        c = self.active_candle
        tp = (c["high"] + c["low"] + c["close"]) / 3.0
        v = c["volume"]
        
        self.cum_tp_v += tp * v
        self.cum_v += v
        self.cum_tp2_v += (tp ** 2) * v
        
        return c

    def get_active_candle_payload(self):
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

    def change_parameters(self, interval_minutes=None, num_std=None):
        if interval_minutes is not None:
            self.interval_minutes = interval_minutes
        if num_std is not None:
            self.num_std = num_std
            
        if num_std is not None and len(self.candles) > 0:
            for c in self.candles:
                c["upper_band"] = float(round(c["vwap"] + (self.num_std * c["std_dev"]), 2))
                c["lower_band"] = float(round(c["vwap"] - (self.num_std * c["std_dev"]), 2))
            if self.active_candle:
                self.active_candle["upper_band"] = float(round(self.active_candle["vwap"] + (self.num_std * self.active_candle["std_dev"]), 2))
                self.active_candle["lower_band"] = float(round(self.active_candle["vwap"] - (self.num_std * self.active_candle["std_dev"]), 2))
        
        logger.info(f"Parameters updated: Interval={self.interval_minutes}m, StdDev={self.num_std}")

