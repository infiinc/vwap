import os
import pandas as pd
import numpy as np
from datetime import datetime, date, timedelta
import json

try:
    from dhanhq import dhanhq, DhanContext
except ImportError:
    print("Error: The 'dhanhq' library is not installed.")
    print("Please install it by running: pip install dhanhq")
    exit(1)

def fetch_and_save_data(client_id, access_token, from_date, to_date, security_id="13", exchange_segment="IDX_I", instrument_type="INDEX", output_file="historical_nifty.csv"):
    """
    Fetches historical 1-minute data from Dhan and saves it as a CSV formatted for the backtester.
    """
    print(f"Initializing Dhan client with Client ID: {client_id}...")
    context = DhanContext(client_id, access_token)
    dhan = dhanhq(context)
    
    print(f"Fetching intraday minute data for security ID '{security_id}' from {from_date} to {to_date}...")
    
    # Call the Dhan API
    response = dhan.intraday_minute_data(
        security_id=security_id,
        exchange_segment=exchange_segment,
        instrument_type=instrument_type,
        from_date=from_date,
        to_date=to_date
    )
    
    # Handle response wrapping
    data = None
    if isinstance(response, dict):
        if "data" in response:
            data = response["data"]
        elif "open" in response:
            data = response
        else:
            raise ValueError(f"Unexpected response format. API Response: {json.dumps(response, indent=2)[:500]}")
            
    if not data or "open" not in data or len(data["open"]) == 0:
        error_msg = "No data returned from Dhan API."
        if isinstance(response, dict) and "remarks" in response and "error_message" in response["remarks"]:
            error_msg = response["remarks"]["error_message"]
        raise ValueError(f"Dhan API Error: {error_msg}. Check credentials, date range, or security ID.")
        
    print(f"Received {len(data['open'])} data points. Parsing into DataFrame...")
    
    # Convert arrays to DataFrame
    df_dict = {
        "timestamp": data.get("start_Time", data.get("start_time")),
        "open": data["open"],
        "high": data["high"],
        "low": data["low"],
        "close": data["close"],
        "volume": data["volume"]
    }
    
    # Clean up none values or check if timestamps are present
    if df_dict["timestamp"] is None:
        # Fallback to alternative timestamp keys
        for key in data.keys():
            if "time" in key.lower() or "date" in key.lower():
                df_dict["timestamp"] = data[key]
                break
                
    if df_dict["timestamp"] is None:
        print("Error: Could not identify timestamp/time column in response keys:", list(data.keys()))
        return
        
    df = pd.DataFrame(df_dict)
    
    # Convert timestamps to human-readable datetime format
    # Dhan timestamps can be epoch seconds
    try:
        # Check if they are epoch timestamps (int/float)
        if isinstance(df["timestamp"].iloc[0], (int, float, np.integer, np.floating)):
            df["timestamp"] = pd.to_datetime(df["timestamp"], unit='s')
        else:
            df["timestamp"] = pd.to_datetime(df["timestamp"])
            
        # Convert to local time string format for backtest runner compatibility
        df["timestamp"] = df["timestamp"].dt.strftime('%Y-%m-%d %H:%M:%S')
    except Exception as e:
        print(f"Warning: Timestamp conversion encountered an error: {e}. Keeping raw timestamp values.")
        
    # Sort chronological
    df = df.sort_values(by="timestamp").reset_index(drop=True)
    
    # Save to file
    df.to_csv(output_file, index=False)
    print(f"[SUCCESS] Historical data successfully saved to: {output_file}")
    print(f"  Total records: {len(df)}")
    print(f"  First record: {df['timestamp'].iloc[0]}")
    print(f"  Last record:  {df['timestamp'].iloc[-1]}")

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Dhan Intraday Historical Data Downloader")
    parser.add_argument("--client_id", type=str, required=True, help="Dhan Client ID")
    parser.add_argument("--access_token", type=str, required=True, help="Dhan API Access Token")
    parser.add_argument("--from_date", type=str, required=True, help="Start Date (YYYY-MM-DD)")
    parser.add_argument("--to_date", type=str, required=True, help="End Date (YYYY-MM-DD)")
    parser.add_argument("--security_id", type=str, default="13", help="Security ID (default Nifty 50: 13)")
    parser.add_argument("--segment", type=str, default="IDX_I", help="Exchange Segment (default: IDX_I)")
    parser.add_argument("--instrument", type=str, default="INDEX", help="Instrument Type (default: INDEX)")
    parser.add_argument("--output", type=str, default="historical_nifty.csv", help="Output file path (default: historical_nifty.csv)")
    
    args = parser.parse_args()
    
    fetch_and_save_data(
        client_id=args.client_id,
        access_token=args.access_token,
        from_date=args.from_date,
        to_date=args.to_date,
        security_id=args.security_id,
        exchange_segment=args.segment,
        instrument_type=args.instrument,
        output_file=args.output
    )
