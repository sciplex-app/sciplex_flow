"""
WebSocket event emitter adapter.

Bridges the core EventEmitter interface with WebSocket connections,
allowing real-time updates to be pushed to connected web clients.
"""

import asyncio
import json
import logging
from typing import Callable, Dict, List, Optional, Set

from fastapi import WebSocket
from sciplex_core.controller.events import EventEmitter

logger = logging.getLogger(__name__)


class WebSocketEventEmitter(EventEmitter):
    """
    Event emitter that broadcasts events to connected WebSocket clients.

    This allows the core controllers to remain framework-agnostic while
    still providing real-time updates to web clients.
    """

    def __init__(self):
        self._listeners: Dict[str, List[Callable]] = {}
        self._connections: Set[WebSocket] = set()
        self._loop: asyncio.AbstractEventLoop = None

    def add_connection(self, websocket: WebSocket) -> None:
        """Add a WebSocket connection to receive events."""
        self._connections.add(websocket)
        logger.info(f"WebSocket connected. Total connections: {len(self._connections)}")

    def remove_connection(self, websocket: WebSocket) -> None:
        """Remove a WebSocket connection."""
        self._connections.discard(websocket)
        logger.info(f"WebSocket disconnected. Total connections: {len(self._connections)}")

    def on(self, event_name: str, callback: Callable) -> None:
        """Register a callback for an event."""
        if event_name not in self._listeners:
            self._listeners[event_name] = []
        self._listeners[event_name].append(callback)

    def emit(self, event_name: str, *args, **kwargs):
        """
        Emit an event to all connected WebSocket clients.

        Events are serialized to JSON and sent to all connections.
        Returns a coroutine that can be awaited if there are connections.
        """
        # Call local listeners first
        if event_name in self._listeners:
            for callback in list(self._listeners[event_name]):
                try:
                    callback(*args, **kwargs)
                except Exception as e:
                    logger.error(f"Error in event callback for {event_name}: {e}")

        # Broadcast to WebSocket clients
        if self._connections:
            # Serialize event data
            event_data = self._serialize_event(event_name, args, kwargs)

            # Return the coroutine so it can be awaited
            return self._broadcast(event_data)

        # No connections - return None
        return None

    async def _broadcast(self, message: str) -> None:
        """Broadcast a message to all connected WebSocket clients."""
        disconnected = set()

        for connection in self._connections:
            try:
                await connection.send_text(message)
            except Exception as e:
                logger.warning(f"Failed to send to WebSocket: {e}")
                disconnected.add(connection)

        # Remove disconnected clients
        for conn in disconnected:
            self._connections.discard(conn)

    def _serialize_event(self, event_name: str, args: tuple, kwargs: dict) -> str:
        """Serialize event data to JSON for WebSocket transmission."""
        # Convert args to serializable format
        serialized_args = []
        for arg in args:
            # Special handling for node_model_created events - use transform_node_for_frontend
            # to ensure full parameter metadata is included
            if event_name == "node_model_created" and hasattr(arg, "id"):
                # Import here to avoid circular dependencies
                from sciplex_flow.backend.main import transform_node_for_frontend
                serialized_args.append(transform_node_for_frontend(arg))
            elif hasattr(arg, "serialize"):
                serialized_args.append(arg.serialize())
            elif hasattr(arg, "__dict__"):
                serialized_args.append(self._obj_to_dict(arg))
            else:
                serialized_args.append(arg)

        event_payload = {
            "event": event_name,
            "data": serialized_args[0] if len(serialized_args) == 1 else serialized_args,
            "kwargs": kwargs
        }

        return json.dumps(event_payload, default=str)

    def _obj_to_dict(self, obj) -> dict:
        """Convert an object to a dictionary, handling nested objects."""
        if hasattr(obj, "serialize"):
            return obj.serialize()

        result = {}
        for key, value in vars(obj).items():
            if key.startswith("_"):
                continue
            if hasattr(value, "serialize"):
                result[key] = value.serialize()
            elif hasattr(value, "__dict__") and not callable(value):
                result[key] = self._obj_to_dict(value)
            elif isinstance(value, (str, int, float, bool, type(None))):
                result[key] = value
            elif isinstance(value, (list, tuple)):
                result[key] = [
                    self._obj_to_dict(item) if hasattr(item, "__dict__") else item
                    for item in value
                ]
        return result

    def disconnect(self, event_name: str, callback: Optional[Callable] = None) -> None:
        """Disconnect a callback from an event."""
        if event_name not in self._listeners:
            return

        if callback is None:
            self._listeners[event_name].clear()
        else:
            if callback in self._listeners[event_name]:
                self._listeners[event_name].remove(callback)

