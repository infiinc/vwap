import logging
import uuid
from datetime import datetime

logger = logging.getLogger("sim_broker")

class SimulatedBroker:
    def __init__(self, initial_balance=100000.0):
        self.initial_balance = initial_balance
        self.balance = initial_balance
        
        # Positions dict: scrip -> {"qty": int, "avg_price": float}
        self.positions = {}
        
        # Active targets dict: scrip -> {"stop_loss": float, "take_profit": float, "risk": float, "entry_price": float}
        self.active_targets = {}
        
        # Order logs list: each order is a dict
        self.orders = []
        
        # Realized profit metrics
        self.realized_pnl = 0.0
        self.total_trades = 0
        self.winning_trades = 0
        self.peak_balance = initial_balance
        self.max_drawdown = 0.0

    def get_position(self, scrip):
        return self.positions.get(scrip, {"qty": 0, "avg_price": 0.0})

    def get_portfolio_value(self, current_prices):
        """
        Calculates net asset value (NAV) = cash + market value of all positions
        """
        portfolio_value = self.balance
        for scrip, pos in self.positions.items():
            qty = pos["qty"]
            if qty != 0:
                price = current_prices.get(scrip, pos["avg_price"])
                portfolio_value += qty * (price - pos["avg_price"]) # market value adjustment
        return portfolio_value

    def get_metrics_payload(self, current_prices):
        current_nav = self.get_portfolio_value(current_prices)
        
        # Update peak balance and drawdown
        self.peak_balance = max(self.peak_balance, current_nav)
        drawdown = 0.0
        if self.peak_balance > 0:
            drawdown = ((self.peak_balance - current_nav) / self.peak_balance) * 100.0
        self.max_drawdown = max(self.max_drawdown, drawdown)
        
        # True round-trip trade-level metrics grouping
        trades_list = []
        current_trade_pnl = 0.0
        in_trade = False
        
        # Sort chronologically
        sorted_orders = sorted(self.orders, key=lambda x: x["timestamp"])
        for o in sorted_orders:
            pnl = o.get("realized_pnl", 0.0)
            if o["type"] == "ENTRY":
                in_trade = True
            if pnl != 0.0:
                current_trade_pnl += pnl
            if o["type"] == "EXIT" or (in_trade and o["type"] in ["PARTIAL_EXIT", "REVERSAL"] and o.get("qty", 0) == 0):
                if in_trade:
                    trades_list.append(current_trade_pnl)
                    current_trade_pnl = 0.0
                    in_trade = False

        win_rate = 0.0
        gross_profit = 0.0
        gross_loss = 0.0
        total_trades = len(trades_list)
        
        if total_trades > 0:
            wins = sum(1 for p in trades_list if p > 0.0)
            win_rate = (wins / total_trades) * 100.0
            self.winning_trades = wins
            gross_profit = sum(p for p in trades_list if p > 0.0)
            gross_loss = sum(p for p in trades_list if p < 0.0)
        else:
            self.winning_trades = 0
        
        # Active position summary for UI
        active_pos_str = "FLAT"
        active_qty = 0
        active_scrip = None
        for s, p in self.positions.items():
            if p["qty"] != 0:
                active_qty = p["qty"]
                active_scrip = s
                dir_str = "LONG" if active_qty > 0 else "SHORT"
                
                # If there are active target stops, display them on the card!
                target = self.active_targets.get(s)
                target_str = ""
                if target:
                    target_str = f" | SL: {target['stop_loss']:.2f} TP: {target.get('take_profit', 0.0):.2f}"
                
                active_pos_str = f"{dir_str} {abs(active_qty)} {s.split('|')[-1]} @ {p['avg_price']:.2f}{target_str}"
                break
                
        unrealized_pnl = 0.0
        if active_scrip and active_qty != 0:
            curr_p = current_prices.get(active_scrip, 0.0)
            if curr_p > 0:
                unrealized_pnl = active_qty * (curr_p - self.positions[active_scrip]["avg_price"])

        return {
            "balance": round(self.balance, 2),
            "nav": round(current_nav, 2),
            "realized_pnl": round(self.realized_pnl, 2),
            "unrealized_pnl": round(unrealized_pnl, 2),
            "total_trades": total_trades, # True trade-level count
            "winning_trades": self.winning_trades,
            "win_rate": round(win_rate, 1),
            "max_drawdown": round(self.max_drawdown, 2),
            "active_position_desc": active_pos_str,
            "active_qty": active_qty,
            "active_scrip": active_scrip,
            "gross_profit": round(gross_profit, 2),
            "gross_loss": round(gross_loss, 2),
            "safety_alert": None
        }

    def execute_order(self, scrip: str, side: str, qty: int, price: float, timestamp: datetime, 
                      stop_loss: float = None, take_profit: float = None, contract_name: str = None, 
                      option_price: float = None, setup_type: str = None, trade_score: float = None, 
                      mfe: float = None, mae: float = None, exit_quality: float = None):
        """
        Executes a paper order, adjusting positions, cash balance, and logging the trade.
        Supports simple long entry, exit, and short entry/exit.
        Side must be 'BUY' or 'SELL'.
        """
        if qty <= 0:
            return None
            
        side = side.upper()
        current_pos = self.positions.get(scrip, {"qty": 0, "avg_price": 0.0})
        old_qty = current_pos["qty"]
        old_avg = current_pos["avg_price"]
        
        realized_pnl = 0.0
        order_type = "ENTRY"
        
        # Calculate new quantity and update positions
        if side == "BUY":
            # If we were SHORT (qty < 0), this is an EXIT or partial exit
            if old_qty < 0:
                # Closing out a short position
                closed_qty = min(qty, abs(old_qty))
                # Short PnL = (Entry Price - Exit Price) * Qty
                realized_pnl = (old_avg - price) * closed_qty
                self.realized_pnl += realized_pnl
                self.balance += (old_avg - price) * closed_qty # Cash adjustment
                
                new_qty = old_qty + qty
                order_type = "EXIT" if new_qty >= 0 else "PARTIAL_EXIT"
                
                if new_qty == 0:
                    new_avg = 0.0
                    if scrip in self.active_targets:
                        del self.active_targets[scrip]
                elif new_qty > 0:
                    # Switched to long
                    new_avg = price
                    order_type = "REVERSAL"
                    if stop_loss and take_profit:
                        self.active_targets[scrip] = {
                            **self.active_targets.get(scrip, {}),
                            "stop_loss": stop_loss,
                            "take_profit": take_profit,
                            "entry_price": price,
                            "highest_price": price,
                            "lowest_price": price
                        }
                else:
                    new_avg = old_avg
            else:
                # Adding to an existing long or opening a new long
                new_qty = old_qty + qty
                # Average price is weighted cost
                if new_qty > 0:
                    new_avg = ((old_qty * old_avg) + (qty * price)) / new_qty
                else:
                    new_avg = price
                order_type = "ENTRY"
                
                if stop_loss and take_profit:
                    self.active_targets[scrip] = {
                        **self.active_targets.get(scrip, {}),
                        "stop_loss": stop_loss,
                        "take_profit": take_profit,
                        "entry_price": price,
                        "highest_price": price,
                        "lowest_price": price
                    }
                
        else: # side == "SELL"
            # If we were LONG (qty > 0), this is an EXIT or partial exit
            if old_qty > 0:
                closed_qty = min(qty, old_qty)
                # Long PnL = (Exit Price - Entry Price) * Qty
                realized_pnl = (price - old_avg) * closed_qty
                self.realized_pnl += realized_pnl
                self.balance += realized_pnl # Cash adjustment
                
                new_qty = old_qty - qty
                order_type = "EXIT" if new_qty <= 0 else "PARTIAL_EXIT"
                
                if new_qty == 0:
                    new_avg = 0.0
                    if scrip in self.active_targets:
                        del self.active_targets[scrip]
                elif new_qty < 0:
                    # Switched to short
                    new_avg = price
                    order_type = "REVERSAL"
                    if stop_loss and take_profit:
                        self.active_targets[scrip] = {
                            **self.active_targets.get(scrip, {}),
                            "stop_loss": stop_loss,
                            "take_profit": take_profit,
                            "entry_price": price,
                            "highest_price": price,
                            "lowest_price": price
                        }
                else:
                    new_avg = old_avg
            else:
                # Adding to short or opening a new short
                new_qty = old_qty - qty
                if abs(new_qty) > 0:
                    new_avg = ((abs(old_qty) * old_avg) + (qty * price)) / abs(new_qty)
                else:
                    new_avg = price
                order_type = "ENTRY"
                
                if stop_loss and take_profit:
                    self.active_targets[scrip] = {
                        **self.active_targets.get(scrip, {}),
                        "stop_loss": stop_loss,
                        "take_profit": take_profit,
                        "entry_price": price,
                        "highest_price": price,
                        "lowest_price": price
                    }

        self.positions[scrip] = {"qty": new_qty, "avg_price": round(new_avg, 2)}
        
        # Log the order
        order_record = {
            "order_id": str(uuid.uuid4())[:8],
            "timestamp": int(timestamp.timestamp()),
            "scrip": scrip.split("|")[-1],
            "side": side,
            "qty": qty,
            "price": round(price, 2),
            "type": order_type,
            "realized_pnl": round(realized_pnl, 2) if order_type in ["EXIT", "PARTIAL_EXIT", "REVERSAL"] else 0.0,
            "cash_balance": round(self.balance, 2),
            "contract_name": contract_name,
            "option_price": option_price,
            "setup_type": setup_type,
            "trade_score": trade_score,
            "mfe": mfe,
            "mae": mae,
            "exit_quality": exit_quality
        }
        
        self.orders.append(order_record)
        logger.info(f"Order executed: {side} {qty} {scrip} @ {price:.2f}. Type: {order_type}, PnL: {realized_pnl:.2f}")
        return order_record

    def reset(self):
        self.balance = self.initial_balance
        self.positions = {}
        self.active_targets = {}
        self.orders = []
        self.realized_pnl = 0.0
        self.total_trades = 0
        self.winning_trades = 0
        self.peak_balance = self.initial_balance
        self.max_drawdown = 0.0
        logger.info("Simulated broker portfolio reset.")
