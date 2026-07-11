import sys
import os
import pandas as pd
import numpy as np

# Add current directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from backtest import OfflineBacktester

best_configs = [
    {"csv": "historical_nifty.csv", "scrip": "NSE|NIFTY 50", "qty": 75, "std": 2.5, "score": 4},
    {"csv": "historical_banknifty.csv", "scrip": "NSE|NIFTY BANK", "qty": 15, "std": 2.5, "score": 4},
    {"csv": "historical_finnifty.csv", "scrip": "NSE|NIFTY FINANCIAL SERVICES", "qty": 40, "std": 2.5, "score": 6},
    {"csv": "historical_sensex.csv", "scrip": "BSE|SENSEX", "qty": 10, "std": 1.5, "score": 5}
]

print("Running detailed analysis for best parameter configurations...")

report_lines = []
report_lines.append("======================================================================")
report_lines.append("                  DETAILED PERFORMANCE ANALYSIS REPORT")
report_lines.append("======================================================================")

for config in best_configs:
    csv_path = config["csv"]
    scrip = config["scrip"]
    qty = config["qty"]
    std = config["std"]
    score = config["score"]
    
    report_lines.append(f"\nInstrument: {scrip} (std={std}, min_score={score})")
    report_lines.append("-" * 50)
    
    try:
        # Redirect prints to avoid cluttering stdout
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
        
        sys.stdout.close()
        sys.stdout = original_stdout
        
        metrics = res["metrics"]
        orders = res["orders"]
        
        # Group orders into trades to analyze trade-level statistics
        # A trade consists of an entry and its corresponding exits
        trades = []
        current_trade = None
        
        for o in sorted(orders, key=lambda x: x["timestamp"]):
            if o["type"] == "ENTRY":
                if current_trade is not None:
                    trades.append(current_trade)
                current_trade = {
                    "entry_time": o["timestamp"],
                    "side": o["side"],
                    "entry_price": o["price"],
                    "entry_option_price": o["option_price"],
                    "qty": o["qty"],
                    "exits": [],
                    "pnl": 0.0,
                    "exit_time": None
                }
            elif o["type"] in ["EXIT", "PARTIAL_EXIT", "REVERSAL"] and current_trade is not None:
                current_trade["exits"].append({
                    "time": o["timestamp"],
                    "price": o["price"],
                    "option_price": o["option_price"],
                    "qty": o["qty"],
                    "pnl": o.get("realized_pnl", 0.0),
                    "exit_quality": o.get("exit_quality", "N/A")
                })
                current_trade["pnl"] += o.get("realized_pnl", 0.0)
                if o["type"] == "EXIT" or o["type"] == "REVERSAL":
                    current_trade["exit_time"] = o["timestamp"]
                    trades.append(current_trade)
                    current_trade = None
                    
        if current_trade is not None:
            trades.append(current_trade)
            
        closed_trades = [t for t in trades if t["exit_time"] is not None]
        
        if len(closed_trades) > 0:
            pnls = [t["pnl"] for t in closed_trades]
            wins = [p for p in pnls if p > 0]
            losses = [p for p in pnls if p <= 0]
            
            avg_win = np.mean(wins) if len(wins) > 0 else 0
            avg_loss = np.mean(losses) if len(losses) > 0 else 0
            max_win = np.max(wins) if len(wins) > 0 else 0
            max_loss = np.min(losses) if len(losses) > 0 else 0
            
            profit_factor = (sum(wins) / abs(sum(losses))) if len(losses) > 0 and sum(losses) != 0 else float('inf')
            
            # Calculate holding times in minutes
            hold_times = []
            for t in closed_trades:
                t1 = pd.to_datetime(t["entry_time"], unit='s')
                t2 = pd.to_datetime(t["exit_time"], unit='s')
                hold_times.append((t2 - t1).total_seconds() / 60.0)
            
            avg_hold_time = np.mean(hold_times)
            
            report_lines.append(f"  Ending Balance:       Rs. {metrics['balance']:,.2f}")
            report_lines.append(f"  Net PnL:              Rs. {metrics['realized_pnl']:+,.2f}")
            report_lines.append(f"  Total Closed Trades:  {len(closed_trades)}")
            report_lines.append(f"  Win Rate:             {len(wins)/len(closed_trades)*100:.1f}% ({len(wins)} W | {len(losses)} L)")
            report_lines.append(f"  Profit Factor:        {profit_factor:.2f}")
            report_lines.append(f"  Avg Win:              Rs. {avg_win:,.2f}")
            report_lines.append(f"  Avg Loss:             Rs. {avg_loss:,.2f}")
            report_lines.append(f"  Max Win:              Rs. {max_win:,.2f}")
            report_lines.append(f"  Max Loss:             Rs. {max_loss:,.2f}")
            report_lines.append(f"  Avg Holding Time:     {avg_hold_time:.1f} minutes")
            report_lines.append(f"  Max Drawdown:         {metrics['max_drawdown']:.2f}%")
        else:
            report_lines.append("  No trades executed.")
            
    except Exception as e:
        sys.stdout = original_stdout
        report_lines.append(f"  Error analyzing config: {e}")

report_content = "\n".join(report_lines)
print(report_content)

# Save to file
with open("detailed_analysis_report.txt", "w") as f:
    f.write(report_content)
print("\nDetailed analysis report saved to detailed_analysis_report.txt")
