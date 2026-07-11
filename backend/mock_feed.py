import random
import asyncio
from datetime import datetime
import math
import logging

logger = logging.getLogger("mock_feed")

SCRIPS = {
    "NSE|NIFTY 50": {"price": 22350.0, "volatility": 0.0001, "avg_volume": 500, "drift": 0.00001},
    "BSE|SENSEX": {"price": 73500.0, "volatility": 0.0001, "avg_volume": 600, "drift": 0.00001},
    "NSE|NIFTY BANK": {"price": 48200.0, "volatility": 0.00015, "avg_volume": 400, "drift": 0.00001},
    "NSE|NIFTY FIN SERVICE": {"price": 21400.0, "volatility": 0.00012, "avg_volume": 300, "drift": 0.00001}
}

class MockFeedGenerator:
    def __init__(self):
        self.state = {k: v["price"] for k, v in SCRIPS.items()}
        self.running = False

    def get_current_price(self, scrip):
        return self.state.get(scrip, 100.0)

    async def generate_ticks(self, active_scrip, callback):
        """
        Periodically yields simulated ticks for active and inactive scrips.
        The active scrip will generate high frequency ticks (multiple per second),
        while inactive ones update slowly.
        """
        self.running = True
        logger.info("Mock tick generator started.")
        
        tick_counter = 0
        
        while self.running:
            # We determine which scrip to generate a tick for.
            # Active scrip ticks 4x more often than others to keep the UI super responsive.
            scrip_keys = list(SCRIPS.keys())
            
            # Weighted random selection: active scrip is selected 70% of the time
            if active_scrip in scrip_keys and random.random() < 0.7:
                selected_scrip = active_scrip
            else:
                selected_scrip = random.choice(scrip_keys)
                
            # Retrieve details
            info = SCRIPS[selected_scrip]
            current_price = self.state[selected_scrip]
            
            # Geometric Brownian Motion simulation step
            # price = price * (1 + drift + vol * random_shock)
            vol = info["volatility"]
            drift = info["drift"]
            
            # Add some trending wave patterns to make the chart look realistic with support/resistance breakouts
            tick_counter += 1
            wave = 0.0005 * math.sin(tick_counter / 50.0)
            
            shock = random.normalvariate(0, 1)
            percent_change = drift + wave + (vol * shock)
            
            new_price = current_price * (1 + percent_change)
            new_price = round(new_price, 2)
            
            # Volume generation: base volume * random factor
            base_vol = info["avg_volume"]
            # Occasional volume spikes
            volume_multiplier = random.uniform(0.2, 1.8)
            if random.random() < 0.05:
                volume_multiplier *= 5.0 # Spike!
                
            volume = max(1, int(base_vol * volume_multiplier))
            
            # Update state
            self.state[selected_scrip] = new_price
            
            # Emit tick payload
            tick_payload = {
                "scrip": selected_scrip,
                "timestamp": datetime.now(),
                "price": new_price,
                "volume": float(volume)
            }
            
            # Send to callback
            try:
                await callback(tick_payload)
            except Exception as e:
                logger.error(f"Error in mock feed callback: {e}")
                
            # Sleep slightly: sleep 100-250ms for active, keeping UI dynamic!
            sleep_time = random.uniform(0.1, 0.25) if selected_scrip == active_scrip else random.uniform(0.3, 0.8)
            await asyncio.sleep(sleep_time)

    def stop(self):
        self.running = False
        logger.info("Mock tick generator stopped.")

    def generate_historical_candles(self, scrip, count=375):
        """
        Generates realistic historical 1-minute OHLCV candles using Geometric Brownian Motion.
        Default count = 375 represents ~6.2 hours (e.g. Nifty market day: 9:15 AM to 3:30 PM).
        """
        info = SCRIPS.get(scrip, {"price": 100.0, "volatility": 0.0003, "avg_volume": 100, "drift": 0.00002})
        price = info["price"]
        vol = info["volatility"]
        drift = info["drift"]
        
        candles = []
        
        from datetime import timedelta
        now = datetime.now()
        
        # Determine the last trading day's market close
        end_date = now.replace(hour=15, minute=30, second=0, microsecond=0)
        if now.hour < 16:
            end_date = end_date - timedelta(days=1)
        while end_date.weekday() >= 5: # Skip weekend if end_date landed on weekend
            end_date = end_date - timedelta(days=1)
            
        # Determine start date by counting back weekdays
        # count // 375 gives the number of days. If count is not multiple of 375, add 1.
        days_needed = (count + 374) // 375
        
        start_date = end_date.replace(hour=9, minute=15)
        days_found = 1
        while days_found < days_needed:
            start_date = start_date - timedelta(days=1)
            if start_date.weekday() < 5:
                days_found += 1
                
        current_time = start_date
        
        for i in range(count):
            # Price movement
            shock = random.normalvariate(0, 1)
            # Add some cyclical swings
            swing = 0.0003 * math.sin(i / 30.0)
            pct_change = drift + swing + (vol * 2.0 * shock)
            
            close_p = price * (1 + pct_change)
            close_p = round(close_p, 2)
            
            # Generate Open, High, Low
            open_p = price
            high_p = max(open_p, close_p) * (1 + abs(random.normalvariate(0, vol * 0.5)))
            low_p = min(open_p, close_p) * (1 - abs(random.normalvariate(0, vol * 0.5)))
            
            high_p = round(high_p, 2)
            low_p = round(low_p, 2)
            
            # Volume
            v = int(info["avg_volume"] * random.uniform(0.5, 1.5))
            if random.random() < 0.05:
                v *= 3.0
                
            candle = {
                "time": current_time,
                "open": open_p,
                "high": high_p,
                "low": low_p,
                "close": close_p,
                "volume": float(v)
            }
            
            candles.append(candle)
            
            # Next price starts at current close
            price = close_p
            # Increment time by 1 minute
            current_time = current_time + timedelta(minutes=1)
            
            # If current time is past 15:30 (3:30 PM), roll to 9:15 AM of the next trading day
            if current_time.hour > 15 or (current_time.hour == 15 and current_time.minute > 30):
                current_time = current_time + timedelta(days=1)
                current_time = current_time.replace(hour=9, minute=15, second=0, microsecond=0)
                while current_time.weekday() >= 5: # Skip weekends
                    current_time = current_time + timedelta(days=1)
            
        return candles
