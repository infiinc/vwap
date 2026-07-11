import os
import logging
import threading
from datetime import datetime
import requests

logger = logging.getLogger("fyers_client")

# Gracefully import fyers_apiv3
try:
    from fyers_apiv3 import fyersModel
    from fyers_apiv3.FyersWebsocket import data_ws
    FYERS_AVAILABLE = True
except ImportError:
    FYERS_AVAILABLE = False
    logger.warning("fyers-apiv3 library is not fully loaded.")

# Symbol mapping
SYMBOL_MAP_UI_TO_FYERS = {
    "NSE|NIFTY 50": "NSE:NIFTY50-INDEX",
    "BSE|SENSEX": "BSE:SENSEX-INDEX",
    "NSE|NIFTY BANK": "NSE:NIFTYBANK-INDEX",
    "NSE|NIFTY FIN SERVICE": "NSE:FINNIFTY-INDEX"
}

class FyersClientWrapper:
    def __init__(self):
        self.api = None
        self.access_token = None
        self.client_id = None
        self.secret_key = None
        self.redirect_uri = None
        self.authenticated = False
        
        self.ws = None
        self.tick_callback = None
        self.log_callback = None
        self.active_symbol = "NSE:NIFTY50-INDEX"

    def log(self, message):
        logger.info(message)
        if self.log_callback:
            self.log_callback(f"[Fyers Client] {message}")

    def _validate_client_id(self, client_id):
        client_id_clean = client_id.strip() if client_id else ""
        if not client_id_clean:
            return None, "Error: App ID (Client ID) is empty."
            
        if "-" not in client_id_clean:
            if len(client_id_clean) <= 8:
                return None, ("Error: It looks like you entered your Fyers UCC Login Username (e.g. DP12345) "
                              "instead of the App ID. Please use the 'App ID' (which ends in '-100') "
                              "from the Fyers API Dashboard at https://myapi.fyers.in.")
            else:
                client_id_clean = f"{client_id_clean}-100"
                self.log(f"Auto-appended '-100' suffix to the Fyers App ID: {client_id_clean}")
                
        return client_id_clean, None

    def get_auth_url(self, client_id, secret_key, redirect_uri):
        """
        Generates the Auth Code Login URL for Fyers OAuth flow.
        """
        if not FYERS_AVAILABLE:
            return "Error: Fyers API package not installed."
            
        client_id_clean, err = self._validate_client_id(client_id)
        if err:
            return err
            
        try:
            self.client_id = client_id_clean
            self.secret_key = secret_key.strip()
            self.redirect_uri = redirect_uri.strip()
            
            session = fyersModel.SessionModel(
                client_id=self.client_id,
                secret_key=self.secret_key,
                redirect_uri=self.redirect_uri,
                response_type="code",
                grant_type="authorization_code"
            )
            return session.generate_authcode()
        except Exception as e:
            return f"Error generating Auth URL: {e}"

    def login(self, client_id, secret_key, redirect_uri, auth_code):
        """
        Exchanges Auth Code for permanent Access Token and initializes the client.
        """
        if not FYERS_AVAILABLE:
            return False, "fyers-apiv3 library is not installed in the python environment."
            
        client_id_clean, err = self._validate_client_id(client_id)
        if err:
            return False, err.replace("Error: ", "")
            
        try:
            self.client_id = client_id_clean
            self.secret_key = secret_key.strip()
            self.redirect_uri = redirect_uri.strip()
            auth_code_clean = auth_code.strip()
            
            # Smart Extraction: If user pasted the full redirect URL or query parameters, extract just the code
            if "http" in auth_code_clean or "?" in auth_code_clean or "auth_code=" in auth_code_clean or "code=" in auth_code_clean:
                from urllib.parse import urlparse, parse_qs
                try:
                    # Clean up double slashes or typical pasting mistakes
                    url_to_parse = auth_code_clean
                    if url_to_parse.startswith("127.0.0.1") or url_to_parse.startswith("localhost"):
                        url_to_parse = "http://" + url_to_parse
                        
                    parsed_url = urlparse(url_to_parse)
                    query_params = parse_qs(parsed_url.query or parsed_url.path)
                    
                    if not query_params and "?" in auth_code_clean:
                        query_part = auth_code_clean.split("?")[-1]
                        query_params = parse_qs(query_part)
                    elif not query_params and "auth_code=" in auth_code_clean:
                        query_params = parse_qs(auth_code_clean)
                    elif not query_params and "code=" in auth_code_clean:
                        query_params = parse_qs(auth_code_clean)
                        
                    extracted_code = query_params.get("auth_code", [None])[0] or query_params.get("code", [None])[0]
                    if extracted_code:
                        self.log(f"Auto-extracted auth_code from pasted text: {extracted_code}")
                        auth_code_clean = extracted_code.strip()
                except Exception as parse_err:
                    self.log(f"Failed to parse pasted auth_code URL: {parse_err}")
            
            self.log("Exchanging Fyers authorization code for access token...")
            session = fyersModel.SessionModel(
                client_id=self.client_id,
                secret_key=self.secret_key,
                redirect_uri=self.redirect_uri,
                response_type="code",
                grant_type="authorization_code"
            )
            session.set_token(auth_code_clean)
            response = session.generate_token()
            
            if not response or "access_token" not in response:
                reason = response.get("message", "Invalid auth code or App credentials.")
                self.log(f"Token generation failed: {reason}")
                return False, f"Auth token failed: {reason}"
                
            self.access_token = response["access_token"]
            self.api = fyersModel.FyersModel(
                client_id=self.client_id,
                token=self.access_token,
                log_path=os.getcwd()
            )
            
            profile = self.api.get_profile()
            if profile and profile.get("s") == "ok":
                name = profile.get("data", {}).get("name", "Fyers Client")
                self.authenticated = True
                self.log(f"Successfully logged in! Welcome, {name}.")
                return True, "Login Successful"
            else:
                msg = profile.get("message", "API validation failed.")
                self.log(f"API validation failed: {msg}")
                return False, f"API Validation Error: {msg}"
                
        except Exception as e:
            err_msg = str(e)
            self.log(f"Exception during Fyers login: {err_msg}")
            return False, f"Exception: {err_msg}"

    def start_feed(self, tick_callback, log_callback):
        """
        Starts the Fyers WebSocket Data Socket.
        """
        if not self.authenticated or not self.access_token:
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
        
        self.log("Opening Fyers Data WebSocket connection...")
        try:
            # Format token as client_id:access_token for Fyers v3 WebSocket authentication
            ws_token = f"{self.client_id}:{self.access_token}"
            self.ws = data_ws.FyersDataSocket(
                access_token=ws_token,
                log_path=os.getcwd(),
                litemode=False,
                write_to_file=False,
                reconnect=True,
                on_connect=self._on_connect,
                on_close=self._on_close,
                on_error=self._on_error,
                on_message=self._on_message
            )
            
            # Start WebSocket in a separate thread so it doesn't block FastAPI
            t = threading.Thread(target=self.ws.connect, daemon=True)
            t.start()
            return True, "WebSocket connection thread started."
        except Exception as e:
            err_msg = str(e)
            self.log(f"Failed to start Fyers WebSocket: {err_msg}")
            return False, f"WebSocket error: {err_msg}"

    def _on_connect(self):
        self.log("Fyers WebSocket connected successfully!")
        self.subscribe(self.active_symbol)

    def _on_close(self):
        self.log("Fyers WebSocket disconnected.")

    def _on_error(self, err):
        self.log(f"Fyers WebSocket Error: {err}")

    def _on_message(self, message):
        """
        Handles incoming Fyers market data ticks and transforms them to strategy format.
        """
        try:
            if not isinstance(message, dict):
                return
                
            symbol = message.get("symbol")
            if not symbol:
                return
                
            # Map Fyers Symbol (e.g. NSE:NIFTY50-INDEX) back to App Ticker (e.g. NSE|NIFTY 50)
            scrip_key = None
            if "NIFTY50" in symbol:
                scrip_key = "NSE|NIFTY 50"
            elif "SENSEX" in symbol:
                scrip_key = "BSE|SENSEX"
            else:
                scrip_key = symbol
                
            # Fyers sends LTP in ltp
            ltp = message.get("ltp")
            if ltp is None:
                return
                
            price = float(ltp)
            # Fyers volume is cumulative day volume (vol_traded)
            volume = float(message.get("vol_traded", 100.0))
            
            tick_data = {
                "scrip": scrip_key,
                "timestamp": datetime.now(),
                "price": price,
                "volume": volume,
                "is_cumulative_volume": True
            }
            
            if self.tick_callback:
                import asyncio
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
                            # If no event loop exists in this thread, schedule it on the default loop if possible
                            pass
                else:
                    self.tick_callback(tick_data)
        except Exception as e:
            logger.error(f"Error parsing Fyers tick: {e}")

    def subscribe(self, scrip):
        """
        Subscribes to a stock index scrip.
        """
        fyers_sym = SYMBOL_MAP_UI_TO_FYERS.get(scrip, scrip)
        self.active_symbol = fyers_sym
        
        if self.ws:
            self.log(f"Subscribing to Fyers market ticks for: {fyers_sym}...")
            try:
                # Fyers v3 WebSocket requires "SymbolUpdate" as the data_type
                self.ws.subscribe(symbols=[fyers_sym], data_type="SymbolUpdate")
                return True
            except Exception as e:
                self.log(f"Error subscribing to {fyers_sym}: {e}")
                return False
        else:
            self.log(f"WebSocket not active yet. Queued Fyers subscription for {fyers_sym}.")
            return True

    def unsubscribe(self, scrip):
        fyers_sym = SYMBOL_MAP_UI_TO_FYERS.get(scrip, scrip)
        if self.ws:
            self.log(f"Unsubscribing from Fyers ticks for: {fyers_sym}...")
            try:
                self.ws.unsubscribe(symbols=[fyers_sym], data_type="SymbolUpdate")
                return True
            except Exception as e:
                self.log(f"Error unsubscribing from {fyers_sym}: {e}")
                return False
        return False

    def get_historical_candles(self, scrip, interval_minutes):
        """
        Downloads today's historical candles from Fyers REST API to pre-populate the chart.
        """
        self.log(f"get_historical_candles called! authenticated={self.authenticated}, api_exists={self.api is not None}")
        if not self.authenticated or not self.api:
            return []
            
        fyers_sym = SYMBOL_MAP_UI_TO_FYERS.get(scrip, scrip)
        
        # Resolution mapping
        resolution = str(interval_minutes)
        if interval_minutes == 1:
            resolution = "1"
        elif interval_minutes == 3:
            resolution = "3"
        elif interval_minutes == 5:
            resolution = "5"
        elif interval_minutes == 15:
            resolution = "15"
            
        # Today's range
        today_str = datetime.now().strftime("%Y-%m-%d")
        
        data = {
            "symbol": fyers_sym,
            "resolution": resolution,
            "date_format": "0",  # epoch timestamp
            "range_from": today_str,
            "range_to": today_str,
            "cont_flag": "1"
        }
        
        self.log(f"Downloading today's ({today_str}) Fyers history for {fyers_sym} (interval {resolution}m)...")
        try:
            response = self.api.history(data=data)
            if response and response.get("s") == "ok":
                candles = response.get("candles", [])
                self.log(f"Successfully downloaded {len(candles)} historical candles from Fyers.")
                
                parsed = []
                for c in candles:
                    parsed.append({
                        "time": datetime.fromtimestamp(int(c[0])),
                        "open": float(c[1]),
                        "high": float(c[2]),
                        "low": float(c[3]),
                        "close": float(c[4]),
                        "volume": float(c[5])
                    })
                return parsed
            else:
                msg = response.get("message", "Unknown error") if response else "No response"
                self.log(f"Failed to fetch Fyers history: {msg}")
                return []
        except Exception as e:
            self.log(f"Error fetching Fyers history: {e}")
            return []

    def get_backtest_candles(self, scrip, interval_minutes, days=1):
        """
        Downloads historical candles for the last N days from Fyers REST API for high-fidelity backtesting.
        """
        if not self.authenticated or not self.api:
            self.log("Fyers Client is not logged in. Cannot fetch historical backtest candles.")
            return []
            
        fyers_sym = SYMBOL_MAP_UI_TO_FYERS.get(scrip, scrip)
        resolution = str(interval_minutes)
        if interval_minutes == 1:
            resolution = "1"
        elif interval_minutes == 3:
            resolution = "3"
        elif interval_minutes == 5:
            resolution = "5"
        elif interval_minutes == 15:
            resolution = "15"
            
        # Calculate standard range_from and range_to dates
        from datetime import timedelta
        now = datetime.now()
        start_date = now - timedelta(days=days)
        
        range_from = start_date.strftime("%Y-%m-%d")
        range_to = now.strftime("%Y-%m-%d")
        
        data = {
            "symbol": fyers_sym,
            "resolution": resolution,
            "date_format": "0",  # epoch timestamps
            "range_from": range_from,
            "range_to": range_to,
            "cont_flag": "1"
        }
        
        self.log(f"Downloading Fyers history for {fyers_sym} ({range_from} to {range_to}) Resolution: {resolution}m...")
        try:
            response = self.api.history(data=data)
            if response and response.get("s") == "ok":
                candles = response.get("candles", [])
                self.log(f"Successfully downloaded {len(candles)} actual historical candles from Fyers.")
                
                parsed = []
                for c in candles:
                    parsed.append({
                        "time": datetime.fromtimestamp(int(c[0])),
                        "open": float(c[1]),
                        "high": float(c[2]),
                        "low": float(c[3]),
                        "close": float(c[4]),
                        "volume": float(c[5])
                    })
                # Sort oldest first
                parsed.sort(key=lambda x: x["time"])
                return parsed
            else:
                msg = response.get("message", "Unknown error") if response else "No response"
                self.log(f"Failed to fetch Fyers history: {msg}")
                return []
        except Exception as e:
            self.log(f"Error fetching Fyers history: {e}")
            return []

    def stop(self):
        if self.ws:
            self.log("Stopping Fyers WebSocket connection...")
            try:
                # Terminate connection using Fyers v3 close_connection() method
                self.ws.close_connection()
            except Exception as e:
                logger.error(f"Error stopping Fyers WebSocket: {e}")
            self.ws = None
        # Keep authentication active so parameter/timeframe changes don't log the user out
        self.log("Fyers market feed stopped. Session remains authenticated.")
