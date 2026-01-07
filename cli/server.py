"""
Sciplex Flow - Local server entry point.

This starts a local FastAPI server that runs Sciplex Flow in your browser,
similar to Jupyter Notebook.
"""

import argparse
import socket
import webbrowser

import uvicorn
from sciplex_flow.backend.main import app


def find_available_port(start_port: int, max_attempts: int = 100) -> int:
    """
    Find an available port starting from start_port.
    
    Similar to Jupyter's port finding logic - tries start_port, then start_port+1, etc.
    
    Args:
        start_port: The port to start checking from
        max_attempts: Maximum number of ports to try
        
    Returns:
        An available port number
        
    Raises:
        OSError: If no available port is found within max_attempts
    """
    for i in range(max_attempts):
        port = start_port + i
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('127.0.0.1', port))
                return port
        except OSError:
            # Port is in use, try next one
            continue
    
    raise OSError(f"Could not find an available port after {max_attempts} attempts starting from {start_port}")


def main():
    """Start local Sciplex Flow server."""
    parser = argparse.ArgumentParser(
        description="Start Sciplex Flow local server",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  sciplex-flow                    # Start on default port (8888) or next available
  sciplex-flow --port 8000        # Start on port 8000 or next available if in use
  sciplex-flow --port 9000        # Start on port 9000 or next available if in use
        """
    )
    parser.add_argument(
        '--port',
        type=int,
        default=8888,
        help='Port to run the server on (default: 8888). If port is in use, will try next available port.'
    )
    
    args = parser.parse_args()
    
    # Find available port
    requested_port = args.port
    try:
        actual_port = find_available_port(requested_port)
    except OSError as e:
        print(f"Error: {e}")
        return 1
    
    host = "127.0.0.1"
    
    # Inform user if port was changed
    port_message = f"Port {actual_port}"
    if actual_port != requested_port:
        port_message += f" (requested {requested_port} was in use)"
    
    print("=" * 60)
    print("Starting Sciplex Flow Local Server")
    print("=" * 60)
    print(f"Server will be available at: http://{host}:{actual_port}")
    print(f"Using {port_message}")
    print("Press Ctrl+C to stop the server")
    print("=" * 60)
    
    # Open browser after a short delay
    def open_browser():
        import time
        time.sleep(1.5)
        webbrowser.open(f"http://{host}:{actual_port}")
    
    import threading
    browser_thread = threading.Thread(target=open_browser, daemon=True)
    browser_thread.start()
    
    try:
        uvicorn.run(
            app,
            host=host,
            port=actual_port,
            log_level="info",
        )
    except KeyboardInterrupt:
        print("\nShutting down server...")
        return 0
    except Exception as e:
        print(f"\nError starting server: {e}")
        return 1


if __name__ == "__main__":
    main()

