import logging
import pyotp
import os
import threading
from datetime import datetime
import json
import requests

logger = logging.getLogger("shoonya_client")

# Attempt to import NorenRestApiPy, fallback to mock/info if it's missing or fails.
# Since we might not have a real Shoonya account, we make sure it fails gracefully.
try:
    from NorenRestApiPy.NorenApi import NorenApi
    SHOO_AVAILABLE = True
except ImportError:
    SHOO_AVAILABLE = False
    logger.warning("NorenRestApiPy is not installed. Shoonya Live Mode will not be functional.")

# Token mapping for popular scrips on NSE
POPULAR_SCRIPS = {
    "NSE|NIFTY 50": {"exchange": "NSE", "token": "26000", "symbol": "NIFTY"},
    "BSE|SENSEX": {"exchange": "BSE", "token": "1", "symbol": "SENSEX"},
    "NSE|NIFTY BANK": {"exchange": "NSE", "token": "26009", "symbol": "BANKNIFTY"},
    "NSE|NIFTY FIN SERVICE": {"exchange": "NSE", "token": "26017", "symbol": "FINNIFTY"}
}

class ShoonyaClient:
    def __init__(self):
        self.api = None
        self.authenticated = False
        self.credentials = {}
        self.socket_opened = False
        self.tick_callback = None
        self.log_callback = None
        
        # Keep track of active subscriptions
        self.subscriptions = set()

    def log(self, message):
        logger.info(message)
        if self.log_callback:
            self.log_callback(f"[Shoonya Client] {message}")

    def login(self, userid, password, totp_secret, api_key, vendor_code):
        """
        Attempts to authenticate with Shoonya.
        Returns a tuple: (success: bool, message: str)
        """
        if not SHOO_AVAILABLE:
            return False, "NorenRestApiPy library is not installed in the python environment."
            
        self.log("Checking Shoonya API server status...")
        try:
            # 1. Proactive pre-check to catch broker server downtimes (502 Bad Gateway) gracefully
            test_res = requests.post("https://api.shoonya.com/NorenWClientTP/QuickAuth", data="jData={}", timeout=5)
            if test_res.status_code == 502:
                self.log("Warning: Shoonya API pre-check returned 502 Bad Gateway. Attempting session login anyway...")
            elif test_res.status_code != 200 and test_res.status_code != 400:
                self.log(f"Warning: Shoonya API server status code is {test_res.status_code}. Attempting session login anyway...")
        except Exception as pre_err:
            self.log(f"Skipping pre-check due to connection error or timeout: {pre_err}")
            
        self.log("Initializing NorenApi client...")
        try:
            self.api = NorenApi(
                host="https://api.shoonya.com/NorenWClientTP/", 
                websocket="wss://api.shoonya.com/NorenWSTP/"
            )
            
            # Generate 2FA TOTP code (supports both 16-char secret key and direct 6-digit numeric entry)
            totp_clean = totp_secret.strip().replace(" ", "")
            if totp_clean.isdigit() and len(totp_clean) == 6:
                self.log("Detected direct 6-digit numeric TOTP code. Using it directly...")
                twofa_code = totp_clean
            else:
                self.log("Generating TOTP code from Base32 secret key...")
                totp = pyotp.TOTP(totp_clean)
                twofa_code = totp.now()
            
            self.log(f"Attempting login for User ID: {userid}...")
            # NorenApi login call
            ret = self.api.login(
                userid=userid,
                password=password,
                twoFA=twofa_code,
                vendor_code=vendor_code,
                api_secret=api_key,
                imei="antigravity_shoonya_app"
            )
            
            if ret is None:
                return False, "Login failed: API returned no response (None)."
                
            if ret.get("stat") == "Ok":
                self.authenticated = True
                self.credentials = {
                    "userid": userid,
                    "password": password,
                    "totp_secret": totp_secret,
                    "api_key": api_key,
                    "vendor_code": vendor_code
                }
                self.log(f"Login successful! User Name: {ret.get('uname', 'Unknown')}, Token: {ret.get('susertoken')[:8]}...")
                return True, "Login Successful"
            else:
                reason = ret.get("reason", "Unknown API error")
                self.log(f"Login failed: {reason}")
                return False, f"Login failed: {reason}"
                
        except Exception as e:
            err_msg = str(e)
            self.log(f"Exception during login: {err_msg}")
            
            # Catch standard JSONDecodeError thrown by the SDK on non-JSON HTML error pages
            if "Expecting value" in err_msg or "json" in err_msg.lower():
                return False, "Shoonya API returned a non-JSON error page (likely 502 Bad Gateway or off-market maintenance). Please use the Mock Market Data in the meantime!"
                
            return False, f"Exception: {err_msg}"

    def start_feed(self, tick_callback, log_callback):
        """
        Starts the Shoonya WebSocket feed.
        """
        if not self.authenticated or not self.api:
            return False, "Client is not logged in."
            
        self.tick_callback = tick_callback
        self.log_callback = log_callback
        
        # Save the active running asyncio loop of the main thread to run callbacks safely
        import asyncio
        try:
            self.loop = asyncio.get_running_loop()
        except RuntimeError:
            try:
                self.loop = asyncio.get_event_loop()
            except Exception:
                self.loop = None
        
        self.log("Opening Shoonya WebSocket connection...")
        try:
            # We start the websocket. The NorenRestApiPy websocket client runs in its own background thread.
            self.api.start_websocket(
                subscribe_callback=self._on_feed_update,
                order_update_callback=self._on_order_update,
                socket_open_callback=self._on_socket_open
            )
            return True, "WebSocket thread started."
        except Exception as e:
            err_msg = str(e)
            self.log(f"Failed to start WebSocket: {err_msg}")
            return False, f"WebSocket error: {err_msg}"

    def _on_socket_open(self):
        self.socket_opened = True
        self.log("WebSocket opened successfully!")
        
        # Re-subscribe to any active subscriptions if we reconnected
        if self.subscriptions:
            self.log(f"Re-subscribing to: {self.subscriptions}")
            for sub in self.subscriptions:
                self.api.subscribe(sub)

    def _on_feed_update(self, tick):
        """
        Internal Shoonya Websocket feed update handler.
        Converts Noren tick to our standardized format and calls user callback.
        """
        try:
            # Parse Shoonya tick payload
            # Noren feed tick keys:
            # 't': touchline data (usually 'tf' or 'tk')
            # 'e': exchange (e.g., 'NSE')
            # 'tk': token (e.g., '2885')
            # 'lp': last price (float)
            # 'v': volume (cumulative volume usually, or tick volume. 
            # Shoonya websocket sends cumulative day volume in 'v')
            exchange = tick.get("e")
            token = tick.get("tk")
            
            # Map back to our scrip string
            scrip_key = None
            for key, val in POPULAR_SCRIPS.items():
                if val["exchange"] == exchange and val["token"] == token:
                    scrip_key = key
                    break
                    
            if not scrip_key:
                # If it's a custom scrip not in popular, format standard name
                scrip_key = f"{exchange}|{token}"
                
            lp = tick.get("lp")
            v = tick.get("v") # Cumulative volume for the day
            
            if lp is None:
                return # Skip tick if last price is not updated
                
            price = float(lp)
            
            # Handle volume: Shoonya sends total cumulative volume in tick 'v'.
            # To get tick-level volume, we need to subtract the previous cumulative volume.
            # We will handle volume aggregation on the fly.
            volume = float(v) if v is not None else 100.0
            
            # Form tick object
            tick_data = {
                "scrip": scrip_key,
                "timestamp": datetime.now(),
                "price": price,
                "volume": volume,
                "is_cumulative_volume": True # Signal strategy that volume is cumulative day volume
            }
            
            if self.tick_callback:
                # Run callback
                import asyncio
                # The websocket thread runs synchronously, so we must run async callbacks safely
                if asyncio.iscoroutinefunction(self.tick_callback):
                    # Use the saved loop of the main thread to run the callback safely across threads
                    loop_to_use = getattr(self, "loop", None)
                    if loop_to_use and loop_to_use.is_running():
                        asyncio.run_coroutine_threadsafe(self.tick_callback(tick_data), loop_to_use)
                    else:
                        try:
                            # Fallback to current thread event loop
                            loop = asyncio.get_event_loop()
                            asyncio.run_coroutine_threadsafe(self.tick_callback(tick_data), loop)
                        except Exception:
                            pass
                else:
                    self.tick_callback(tick_data)
                    
        except Exception as e:
            logger.error(f"Error handling Shoonya tick: {e}")

    def _on_order_update(self, order):
        self.log(f"Live Order Update: {json.dumps(order)}")

    def subscribe(self, scrip):
        """
        Subscribes to a stock scrip.
        scrip is e.g. "NSE|RELIANCE"
        """
        if not self.api:
            return False
            
        scrip_info = POPULAR_SCRIPS.get(scrip)
        if not scrip_info:
            # Attempt to resolve via search scrip or custom split
            parts = scrip.split("|")
            if len(parts) == 2:
                scrip_info = {"exchange": parts[0], "token": parts[1]}
            else:
                self.log(f"Invalid scrip to subscribe: {scrip}")
                return False
                
        exchange = scrip_info["exchange"]
        token = scrip_info["token"]
        sub_str = f"{exchange}|{token}"
        
        self.subscriptions.add(sub_str)
        
        if self.socket_opened:
            self.log(f"Subscribing to {sub_str} on Shoonya...")
            self.api.subscribe(sub_str)
            return True
        else:
            self.log(f"WebSocket not open yet. Queued subscription to {sub_str}.")
            return True

    def unsubscribe(self, scrip):
        if not self.api:
            return False
            
        scrip_info = POPULAR_SCRIPS.get(scrip)
        if scrip_info:
            sub_str = f"{scrip_info['exchange']}|{scrip_info['token']}"
        else:
            parts = scrip.split("|")
            sub_str = f"{parts[0]}|{parts[1]}" if len(parts) == 2 else scrip
            
        if sub_str in self.subscriptions:
            self.subscriptions.remove(sub_str)
            
        if self.socket_opened:
            self.log(f"Unsubscribing from {sub_str}...")
            self.api.unsubscribe(sub_str)
            return True
        return False

    def stop(self):
        if self.api and self.socket_opened:
            self.log("Closing Shoonya WebSocket feed...")
            try:
                self.api.close_websocket()
                self.socket_opened = False
            except Exception as e:
                logger.error(f"Error closing WebSocket: {e}")
        # Keep authentication active so parameter/timeframe changes don't log the user out
        self.subscriptions.clear()
        self.log("Shoonya market feed stopped. Session remains authenticated.")
