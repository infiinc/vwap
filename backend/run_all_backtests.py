import sys
import os
import pandas as pd

# Add the current directory to python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from backtest import OfflineBacktester

files = [
    {"csv": "historical_nifty.csv", "scrip": "NSE|NIFTY 50", "qty": 75},
    {"csv": "historical_banknifty.csv", "scrip": "NSE|NIFTY BANK", "qty": 15},
    {"csv": "historical_finnifty.csv", "scrip": "NSE|NIFTY FINANCIAL SERVICES", "qty": 40},
    {"csv": "historical_sensex.csv", "scrip": "BSE|SENSEX", "qty": 10}
]

print("Starting backtesting for all instruments...")
results = {}

for f in files:
    csv_path = f["csv"]
    scrip = f["scrip"]
    qty = f["qty"]
    print(f"\n==================== Running {scrip} ({csv_path}) ====================")
    try:
        backtester = OfflineBacktester(initial_balance=100000.0, vix_value=15.0, qty=qty)
        res = backtester.run(
            csv_path=csv_path,
            scrip=scrip,
            interval_minutes=1,
            num_std=2.0,
            min_checklist_score=60 # maps to 4
        )
        results[scrip] = res["metrics"]
    except Exception as e:
        print(f"Error running backtest for {scrip}: {e}")

print("\n\n" + "#" * 50)
print("AGGREGATED BACKTEST RESULTS (Min Checklist Score = 4)")
print("#" * 50)
for scrip, metric in results.items():
    print(f"\nInstrument: {scrip}")
    print(f"  Ending Balance:   Rs. {metric['balance']:,.2f}")
    print(f"  Net Realized PnL: Rs. {metric['realized_pnl']:+,.2f}")
    print(f"  Total Trades:     {metric['total_trades']}")
    print(f"  Win Rate:         {metric['win_rate']:.1f}%")
    print(f"  Max Drawdown:     {metric['max_drawdown']:.2f}%")
    print(f"  Gross Profit:     Rs. {metric['gross_profit']:,.2f}")
    print(f"  Gross Loss:       Rs. {metric['gross_loss']:,.2f}")
