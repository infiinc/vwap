import sys
import os
import pandas as pd
import json

# Add the current directory to python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from backtest import OfflineBacktester

files = [
    {"csv": "historical_nifty.csv", "scrip": "NSE|NIFTY 50", "qty": 75},
    {"csv": "historical_banknifty.csv", "scrip": "NSE|NIFTY BANK", "qty": 15},
    {"csv": "historical_finnifty.csv", "scrip": "NSE|NIFTY FINANCIAL SERVICES", "qty": 40},
    {"csv": "historical_sensex.csv", "scrip": "BSE|SENSEX", "qty": 10}
]

std_values = [1.5, 2.0, 2.5]
score_values = [4, 5, 6] # Checklist scores directly

results = []

print("Running parameter grid search...")

for f in files:
    csv_path = f["csv"]
    scrip = f["scrip"]
    qty = f["qty"]
    
    for std in std_values:
        for score in score_values:
            print(f"Testing {scrip} with std={std}, score={score}...")
            try:
                # Redirect prints or temporarily disable printing to avoid cluttering logs
                # Save standard stdout
                original_stdout = sys.stdout
                sys.stdout = open(os.devnull, 'w')
                
                backtester = OfflineBacktester(initial_balance=100000.0, vix_value=15.0, qty=qty)
                res = backtester.run(
                    csv_path=csv_path,
                    scrip=scrip,
                    interval_minutes=1,
                    num_std=std,
                    min_checklist_score=score
                )
                
                # Restore stdout
                sys.stdout.close()
                sys.stdout = original_stdout
                
                metrics = res["metrics"]
                results.append({
                    "scrip": scrip,
                    "std": std,
                    "score": score,
                    "ending_balance": metrics["balance"],
                    "realized_pnl": metrics["realized_pnl"],
                    "total_trades": metrics["total_trades"],
                    "win_rate": metrics["win_rate"],
                    "max_drawdown": metrics["max_drawdown"]
                })
            except Exception as e:
                # Restore stdout on error
                sys.stdout = original_stdout
                print(f"Error for {scrip} (std={std}, score={score}): {e}")

# Save grid search results to CSV
df_results = pd.DataFrame(results)
output_path = "grid_search_detailed.csv"
df_results.to_csv(output_path, index=False)
print(f"\nGrid search completed. Results saved to {output_path}")

# Display best parameters per instrument
print("\n=== BEST PARAMETER COMBINATIONS PER INSTRUMENT (by Net PnL) ===")
for scrip in df_results["scrip"].unique():
    df_scrip = df_results[df_results["scrip"] == scrip]
    best_row = df_scrip.loc[df_scrip["realized_pnl"].idxmax()]
    print(f"\nInstrument: {scrip}")
    print(f"  Best Std Dev:       {best_row['std']}")
    print(f"  Best Min Score:     {best_row['score']}")
    print(f"  Max Realized PnL:   Rs. {best_row['realized_pnl']:+,.2f}")
    print(f"  Ending Balance:     Rs. {best_row['ending_balance']:,.2f}")
    print(f"  Win Rate:           {best_row['win_rate']:.1f}%")
    print(f"  Total Trades:       {best_row['total_trades']}")
    print(f"  Max Drawdown:       {best_row['max_drawdown']:.2f}%")
