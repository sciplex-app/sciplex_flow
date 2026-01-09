"""
Sciplex Web Backend - FastAPI Server

This server provides:
- REST API for graph operations
- WebSocket for real-time updates
- Node library information
- Graph execution
"""

# ruff: noqa: E402

import importlib.util
import importlib.resources as pkg_resources
import json
import logging
import os
import shutil
import subprocess
import sys
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

# Set matplotlib backend to Agg (non-interactive) before any library imports
# This must be done before libraries (like visuals.py) are loaded
import matplotlib

matplotlib.use('Agg')  # Non-interactive backend for web/server

import numpy as np
import pandas as pd
from fastapi import (
    FastAPI,
    File,
    HTTPException,
    Query,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Add project root to Python path for core imports
# sciplex-flow/backend/main.py -> sciplex-flow/backend -> sciplex-flow -> repo root
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

# Workspace configuration
# For single-user: uses ~/Sciplex/workspace/
# For multi-user (future): can be extended to use per-user directories
WORKSPACE_ROOT = os.getenv('SCIPLEX_WORKSPACE_ROOT', str(Path.home() / "Sciplex" / "workspace"))

from sciplex_core.controller.scene_controller import SceneController
from sciplex_core.model.library_model import library_model
from sciplex_core.model.node_model import EXECUTED, FAILED
from sciplex_core.model.socket_model import SocketModel
from sciplex_core.utils.functions import variables_registry
from sciplex_core.utils.library_loader import LibraryLoader
from sciplex_core.utils.script_node import SCRIPT_DEFAULT_CODE

from sciplex_flow.backend.adapters.websocket_emitter import WebSocketEventEmitter

# Local mode: No authentication needed
# from web.backend.auth.database import init_db, get_db
# from web.backend.auth.routes import router as auth_router
# from web.backend.auth.dependencies import get_current_user
# from web.backend.auth.database import User

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s"
)
logger = logging.getLogger(__name__)

# Note: FastAPI app will be initialized after lifespan function is defined

# Global state
base_dir = os.path.join(Path.home(), "Sciplex")  # Legacy, kept for compatibility
ws_emitter = WebSocketEventEmitter()
# Local mode: Single scene controller
local_scene_controller: Optional[SceneController] = None

# Default library icons that should always be present in the workspace
DEFAULT_LIBRARY_ICONS = {
    "boolean", "folder", "dataset", "list", "csv", "data_table", "number",
    "data_array", "function", "save", "input", "barchart", "boxplot",
    "histogram", "Line", "scatter", "poly", "plot2", "subplot", "grid",
    "arithm", "corr", "cumsum", "diff", "logical", "MaxMin", "not", "rel",
    "map1d", "map2d", "roll", "TableFormula", "score", "table",
    "decisiontree", "encoder", "transform", "linreg", "predict",
    "randomforest", "split", "xgboost", "cut", "add_row", "info", "bin",
    "filter", "group", "nans", "pivot", "change", "select", "shift",
    "sort", "switch", "square",
}


async def emit_execution_states(scene_controller: SceneController) -> None:
    if not scene_controller.model.graph:
        return

    emit_coroutines = []
    for node in scene_controller.model.graph.nodes:
        if node.executed or node.failed:
            state = EXECUTED if node.executed and not node.failed else FAILED
            message = "" if node.executed and not node.failed else "Execution failed"
            emit_result = ws_emitter.emit("execute_state_updated", state, message, node_id=node.id)
            if emit_result is not None:
                emit_coroutines.append(emit_result)

    for coro in emit_coroutines:
        try:
            await coro
        except Exception as e:
            logger.warning(f"Failed to send execution state update via WebSocket: {e}")


# ============================================================================
# Pydantic Models for API
# ============================================================================

class NodePosition(BaseModel):
    x: float
    y: float


class CreateNodeRequest(BaseModel):
    node_type: str
    position: NodePosition


class CreateNodeFromCodeRequest(BaseModel):
    code: str
    position: NodePosition


class CreateEdgeRequest(BaseModel):
    source_node_id: str
    source_socket_id: str
    target_node_id: str
    target_socket_id: str


class UpdateParameterRequest(BaseModel):
    node_id: str
    parameter_name: str
    value: Any


class ExecuteNodeRequest(BaseModel):
    node_id: str


class SaveProjectRequest(BaseModel):
    project_name: str
    overwrite: bool = False


class LoadProjectRequest(BaseModel):
    project_name: str


# ============================================================================
# Startup / Shutdown
# ============================================================================

def initialize_workspace():
    """Initialize the workspace with default libraries and icons.

    This function ensures default libraries and icons are present in the workspace.
    If any default files are missing (e.g., deleted by the user), they will be restored.
    """
    workspace_libraries_dir = get_workspace_libraries_dir()
    workspace_icons_dir = get_workspace_icons_dir()

    # Copy default libraries to workspace/libraries/default folder
    default_dest_dir = workspace_libraries_dir / "default"
    default_dest_dir.mkdir(parents=True, exist_ok=True)

    try:
        with pkg_resources.as_file(pkg_resources.files("sciplex_core.libraries.default")) as source_dir:
            logger.info(f"Checking default libraries in {default_dest_dir}")
            node_files = ["_helpers.py", "data.py", "math.py", "transform.py", "visuals.py", "machine_learning.py"]

            restored_count = 0
            for filename in node_files:
                source_path = source_dir / filename
                dest_path = default_dest_dir / filename

                if source_path.exists() and not dest_path.exists():
                    shutil.copy2(str(source_path), str(dest_path))
                    logger.info(f"Restored default library file {filename}")
                    restored_count += 1

            if restored_count > 0:
                logger.info(f"Restored {restored_count} default library file(s)")

            readme_src = source_dir.parent / "README.md"
            readme_dest = default_dest_dir / "README.md"
            if readme_src.exists():
                shutil.copy2(str(readme_src), str(readme_dest))
                logger.info("Ensured libraries/README.md exists in workspace default libraries")
    except ModuleNotFoundError:
        logger.warning("sciplex_core not found when trying to restore default libraries")
    except Exception as e:
        logger.warning(f"Could not verify/copy default libraries: {e}")

    # Copy default icons to workspace/icons folder
    assets_icons_path = get_assets_icons_path()

    if assets_icons_path and assets_icons_path.exists():
        logger.info(f"Checking default icons in {workspace_icons_dir}")
        icons_restored = 0
        icons_updated = 0
        for icon_file in assets_icons_path.iterdir():
            if icon_file.is_file() and icon_file.suffix.lower() in ['.png', '.svg', '.jpg', '.jpeg']:
                icon_name = icon_file.stem  # Name without extension

                # Skip toolbar icons (action_* icons are for UI only, not for nodes)
                if icon_name.startswith('action_'):
                    continue

                dest_icon = workspace_icons_dir / icon_file.name

                # For default library icons, always restore if missing (user may have deleted them)
                # Also update them if they exist (they're now black icons)
                if icon_name in DEFAULT_LIBRARY_ICONS:
                    # Check if icon is missing or needs update
                    if not dest_icon.exists():
                        shutil.copy2(str(icon_file), str(dest_icon))
                        icons_restored += 1
                        logger.debug(f"Restored default library icon {icon_file.name}")
                    else:
                        # Update default library icons (force overwrite to ensure latest version)
                        shutil.copy2(str(icon_file), str(dest_icon))
                        icons_updated += 1
                else:
                    # For non-default icons, only copy if missing (preserve user customizations)
                    if not dest_icon.exists():
                        shutil.copy2(str(icon_file), str(dest_icon))
                        icons_restored += 1

        if icons_restored > 0 or icons_updated > 0:
            logger.info(f"Restored {icons_restored} missing icon(s) and updated {icons_updated} default library icon(s)")

    # Load libraries from workspace
    load_libraries()


def load_libraries():
    """Load all libraries from the workspace directory."""
    workspace_libraries_dir = get_workspace_libraries_dir()
    workspace_base_dir = str(get_workspace_root())

    # Create library loader with workspace base directory
    library_loader = LibraryLoader(workspace_base_dir)

    # Ensure default libraries folder is in sys.path for _helpers imports
    default_dest_dir = workspace_libraries_dir / "default"
    if str(default_dest_dir) not in sys.path:
        sys.path.insert(0, str(default_dest_dir))

    # Load library configuration
    library_config = load_library_config()

    def load_libraries_from_dir(directory: Path, base_lib_dir: Path):
        """Recursively load all .py files from a directory."""
        if not directory.exists():
            return

        # Also add this directory to sys.path for local imports
        if str(directory) not in sys.path:
            sys.path.insert(0, str(directory))

        for item in sorted(directory.iterdir()):
            if item.name.startswith("."):
                continue
            if item.is_dir() and not item.name.startswith("_"):
                load_libraries_from_dir(item, base_lib_dir)  # Recurse into subdirectories
            elif item.is_file() and item.suffix == ".py" and not item.name.startswith("_"):
                # Skip files starting with _ (like _helpers.py) - they're helpers, not node libraries
                # Get relative path from base_lib_dir for config lookup
                try:
                    rel_path = item.relative_to(base_lib_dir)
                    library_path = str(rel_path).replace("\\", "/")  # Normalize path separators

                    # Check if library is enabled
                    if not is_library_enabled(library_path, library_config):
                        logger.debug(f"Skipping disabled library: {library_path}")
                        continue

                    result = library_loader.load_library_file(str(item))
                    if result.get("success"):
                        logger.info(f"Loaded library: {item.name}")
                    else:
                        logger.warning(f"Failed to load library {item.name}: {result.get('message')}")
                except Exception as e:
                    logger.error(f"Error loading library {item.name}: {e}")

    if workspace_libraries_dir.exists():
        logger.info(f"Loading libraries from: {workspace_libraries_dir}")
        load_libraries_from_dir(workspace_libraries_dir, workspace_libraries_dir)

    # Register script node
    try:
        from sciplex_core.utils.script_node import register_script_node
        register_script_node()
    except Exception as e:
        logger.warning(f"Could not register script node: {e}")


def get_local_scene_controller() -> SceneController:
    """Get or create the local scene controller (single-user mode)."""
    global local_scene_controller
    if local_scene_controller is None:
        # Initialize workspace with default libraries and icons
        initialize_workspace()

        from sciplex_core.controller.clipboard_interface import MockClipboard
        base_dir = str(get_workspace_root())
        # Initialize workspace directories
        get_workspace_files_dir()
        get_workspace_libraries_dir()
        get_workspace_projects_dir()
        get_workspace_icons_dir()

        local_scene_controller = SceneController(
            base_dir=base_dir,
            event_emitter=ws_emitter,
            clipboard=MockClipboard()
        )
    return local_scene_controller


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup and shutdown events."""
    # Startup
    logger.info("Starting Sciplex Local Web Backend...")

    # Local mode: No database needed
    # logger.info("Initializing database...")
    # init_db()
    # logger.info("Database initialized")

    # Note: Workspace initialization (libraries and icons) is done when
    # the local scene controller is first created via get_local_scene_controller()

    # Register script node globally (only needs to be done once)
    try:
        from sciplex_core.utils.script_node import register_script_node
        register_script_node()
        logger.info("Registered script node")
    except Exception as e:
        logger.warning(f"Could not register script node: {e}")

    logger.info("Sciplex Local Web Backend started successfully!")

    yield  # Application runs here

    # Shutdown (if needed)
    logger.info("Shutting down Sciplex Web Backend...")


# Initialize FastAPI app with lifespan
app = FastAPI(
    title="Sciplex Flow API",
    description="API for node-based data science workflows",
    version="1.0.0",
    lifespan=lifespan
)

# Configure CORS
# Allow all origins in development, or set specific origins for production via CORS_ORIGINS env var
cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Local mode: No auth routes needed
# app.include_router(auth_router)

# Serve frontend static files (if dist folder exists)
# In development, this might not exist - user needs to run: npm run build:local
frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    # Serve static files (JS, CSS, images, etc.)
    static_dir = frontend_dist / "static"
    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    # Note: The catch-all route for SPA routing is defined at the END of this file
    # after all API routes to ensure proper route matching order
else:
    logger.warning(
        f"Frontend dist/ not found at {frontend_dist}. "
        "For development, run: cd sciplex/web/frontend && npm run build:local"
    )


# ============================================================================
# Configuration Endpoint
# ============================================================================

@app.get("/api/config")
async def get_config():
    """Get application configuration, including whether running in local mode."""
    return {
        "is_local_mode": True,  # This backend is always local mode
    }


# ============================================================================
# WebSocket Endpoint
# ============================================================================

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time updates.

    Clients connect here to receive events like:
    - node_model_created
    - edge_model_created
    - execution state changes
    """
    await websocket.accept()
    ws_emitter.add_connection(websocket)

    try:
        while True:
            # Receive messages from client
            data = await websocket.receive_text()
            message = json.loads(data)

            # Handle incoming messages
            await handle_ws_message(websocket, message)

    except WebSocketDisconnect:
        ws_emitter.remove_connection(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        ws_emitter.remove_connection(websocket)


async def handle_ws_message(websocket: WebSocket, message: dict):
    """Handle incoming WebSocket messages from clients."""
    action = message.get("action")

    if action == "ping":
        await websocket.send_text(json.dumps({"event": "pong"}))

    elif action == "get_graph":
        # Note: WebSocket doesn't have user context yet, so we can't send graph state
        # The frontend should use the REST API /api/graph endpoint instead
        # For now, send empty graph state
        graph_data: Dict[str, list] = {
            "nodes": [],
            "edges": [],
            "annotations": [],
        }

        await websocket.send_text(json.dumps({
            "event": "graph_state",
            "data": graph_data
        }))


# ============================================================================
# Library Endpoints
# ============================================================================

@app.get("/api/libraries")
async def get_libraries() -> Dict[str, List[dict]]:
    """Get all available node libraries and their nodes for the current user."""
    # Ensure user's workspace is initialized (this loads libraries on first call)
    _ = get_local_scene_controller()

    # Note: We don't reload libraries here anymore. Libraries are loaded:
    # - On startup (via get_local_scene_controller -> load_libraries)
    # - When toggling enabled/disabled (via reload_custom_libraries)
    # - When manually reloading (via /api/workspace/libraries/reload)
    # Reloading here caused issues where disabled libraries could be re-added
    # before the model was properly cleaned up.

    libraries: Dict[str, List[dict]] = {}

    for name, item in library_model.get_library_items().items():
        lib_name = item.library_name

        if lib_name not in libraries:
            libraries[lib_name] = []

        # Serialize parameters safely (values might be complex objects)
        serialized_params = {}
        for param_name, attr in (item.parameters or {}).items():
            try:
                # Try to use the value directly, fall back to string representation
                value = attr.value
                # Check if value is JSON serializable
                import json
                json.dumps(value)
            except (TypeError, ValueError):
                # Convert non-serializable values to string
                value = str(attr.value) if attr.value is not None else None

            serialized_params[param_name] = {
                "widget": attr.widget,
                "value": value,
                "options": attr.options
            }

        libraries[lib_name].append({
            "name": name,
            "icon": item.icon,
            "description": item.description or "",
            "inputs": [
                {"name": inp[0], "type": str(inp[1]) if inp[1] else "any"}
                for inp in (item.inputs or [])
            ],
            "outputs": [
                {"name": out[0], "type": str(out[1]) if out[1] else "any"}
                for out in (item.outputs or [])
            ],
            "parameters": serialized_params
        })

    return libraries


@app.get("/api/library/{library_name}")
async def get_library_nodes(library_name: str) -> List[dict]:
    """Get nodes from a specific library."""
    nodes = []

    for name, item in library_model.get_library_items().items():
        if item.library_name == library_name:
            nodes.append({
                "name": name,
                "icon": item.icon,
                "description": item.description or ""
            })

    return nodes


# ============================================================================
# Icon Endpoints
# ============================================================================

@app.get("/api/icons/{icon_name}")
async def get_icon(icon_name: str, variant: Optional[str] = Query(None, description="Icon variant (legacy, ignored - all icons are now black)")):
    """Serve node icons from the workspace/icons folder or assets folder.

    Priority order:
    1. workspace/icons (user-defined icons)
    2. assets/icons (default icons)

    Note: All icons are now black icons. The variant parameter is kept for backward compatibility but ignored.
    
    Args:
        icon_name: Base name of the icon (e.g., "csv", "scatter")
        variant: Icon variant suffix (legacy, ignored - all icons are black now).
    """
    # Strip any file extension from icon_name (e.g., "csv.png" -> "csv")
    icon_base = icon_name
    if icon_base.endswith(('.png', '.svg', '.jpg', '.jpeg')):
        icon_base = icon_base.rsplit('.', 1)[0]

    # All icons are now black icons - no variant handling needed
    icon_variants = [
        f"{icon_base}.png",
        f"{icon_base}.svg",
    ]

    # Get workspace icons directory
    workspace_icons_dir = get_workspace_icons_dir()

    # Only serve icons that exist in the workspace/icons directory for library/node icons.
    # If the user deleted an icon during a session, it will be missing until restart (initialize_workspace re-seeds defaults).
    for variant_file in icon_variants:
        icon_path = workspace_icons_dir / variant_file
        if icon_path.exists():
            return FileResponse(
                path=str(icon_path),
                media_type="image/png" if variant_file.endswith(".png") else "image/svg+xml"
            )

    # Fallback for UI/toolbar icons (action_*) that are not user-editable: serve from packaged assets
    if icon_base.startswith("action_"):
        assets_icons_path = get_assets_icons_path()
        if assets_icons_path:
            for variant_file in icon_variants:
                icon_path = assets_icons_path / variant_file
                if icon_path.exists():
                    return FileResponse(
                        path=str(icon_path),
                        media_type="image/png" if variant_file.endswith(".png") else "image/svg+xml"
                    )

    # Return 404 if icon not found
    raise HTTPException(status_code=404, detail=f"Icon '{icon_name}' not found")


# ============================================================================
# Graph Endpoints
# ============================================================================

@app.get("/api/graph")
async def get_graph():
    """Get the current graph state including annotations."""
    scene_controller = get_local_scene_controller()

    # Get graph serialization - transform nodes for frontend format
    if scene_controller.model.graph:
        graph_data = scene_controller.model.graph.serialize()
        # Transform each node using transform_node_for_frontend to ensure proper parameter structure
        transformed_nodes = []
        for node_data in graph_data.get("nodes", []):
            # Find the actual node model to transform
            node_id = node_data.get("id")
            if node_id:
                node_model = None
                for node in scene_controller.model.graph.nodes:
                    if node.id == node_id:
                        node_model = node
                        break
                if node_model:
                    transformed_nodes.append(transform_node_for_frontend(node_model))
                else:
                    # Fallback: use serialized data as-is if node not found
                    transformed_nodes.append(node_data)
        graph_data["nodes"] = transformed_nodes
    else:
        graph_data = {"nodes": [], "edges": []}

    # Get annotations serialization
    annotations_data = [
        {
            "id": ann.id,
            "text": ann.text,
            "pos_x": ann.pos_x,
            "pos_y": ann.pos_y,
            "width": ann.width,
            "height": ann.height,
            "is_selected": ann.is_selected,
        }
        for ann in scene_controller.model.scene_annotations
    ]

    return {
        "nodes": graph_data.get("nodes", []),
        "edges": graph_data.get("edges", []),
        "annotations": annotations_data,
    }


@app.get("/api/graph/stats")
async def get_graph_stats():
    """Get graph statistics (node and edge counts)."""
    scene_controller = get_local_scene_controller()

    if not scene_controller.model.graph:
        return {"nodes": 0, "edges": 0}

    graph = scene_controller.model.graph
    return {
        "nodes": len(graph.nodes) if graph.nodes else 0,
        "edges": len(graph.edges) if graph.edges else 0,
    }


@app.get("/api/nodes/{node_id}/parameter-options")
async def get_parameter_options(node_id: str, source: str, extractor: str, ):
    """Get parameter options by applying an extractor to a node's input socket data."""
    scene_controller = get_local_scene_controller()

    if not scene_controller.model.graph:
        raise HTTPException(status_code=404, detail="Graph not found")

    # Find the node
    graph = scene_controller.model.graph
    node_model = None
    for node in graph.nodes:
        if node.id == node_id:
            node_model = node
            break

    if not node_model:
        raise HTTPException(status_code=404, detail="Node not found")

    # Find the input socket by name (source is the function parameter name, e.g., "train_data")
    input_socket = None
    for socket in node_model.input_sockets:
        if socket.name == source:
            input_socket = socket
            break

    if not input_socket:
        logger.warning(f"Input socket '{source}' not found on node {node_id}")
        return {"options": []}

    # Check if socket is connected
    if not input_socket.edges:
        logger.info(f"Input socket '{source}' on node {node_id} is not connected")
        return {"options": []}

    # Get data from the socket (from connected edge)
    edge = input_socket.edges[0]
    data = edge.start_socket.get_data()

    # If no data, try executing the source node
    if data is None:
        source_node = edge.start_socket.node
        if source_node:
            from sciplex_core.controller.node_controller import NodeController
            node_controller = NodeController(source_node)
            try:
                logger.info(f"Executing source node {source_node.id} to get data for parameter options")
                node_controller.execute()
                data = edge.start_socket.get_data()
            except Exception as e:
                logger.warning(f"Failed to execute source node for options: {e}")

    if data is None:
        logger.warning(f"No data available from input socket '{source}' on node {node_id}")
        return {"options": []}

    # Apply extractor
    try:
        from sciplex_core.utils.ui_updaters import EXTRACTOR_REGISTRY
        if extractor in EXTRACTOR_REGISTRY:
            extractor_func = EXTRACTOR_REGISTRY[extractor]
            options = extractor_func(data)
            # Ensure options is a list
            if not isinstance(options, list):
                logger.warning(f"Extractor '{extractor}' returned non-list result: {type(options)}")
                return {"options": []}
            return {"options": options}
        else:
            logger.warning(f"Extractor '{extractor}' not found in registry")
            return {"options": []}
    except Exception as e:
        logger.error(f"Error applying extractor '{extractor}' to data: {e}", exc_info=True)
        return {"options": []}


@app.post("/api/graph/clear")
async def clear_graph():
    """Clear the current graph."""
    scene_controller = get_local_scene_controller()
    scene_controller.clear_scene()
    return {"success": True}


# ============================================================================
# Node Endpoints
# ============================================================================

def transform_node_for_frontend(node_model) -> dict:
    """Transform a NodeModel to the format expected by the frontend."""
    try:
        serialized = node_model.serialize()

        # CRITICAL: Remove the serialized parameters (which are just {name: value})
        # We'll replace them with the full transformed version below
        if "parameters" in serialized:
            del serialized["parameters"]

        # Add description from model property (like desktop version)
        serialized["description"] = getattr(node_model, "description", None) or ""

        # Transform parameters from {name: value} to {name: {widget, value, options}}
        # Also extract parameter descriptions and types from docstring for tooltips
        transformed_params = {}

        # Extract parameter info from docstring if available
        param_descriptions = {}
        param_types = {}
        if hasattr(node_model, 'execute_fn') and node_model.execute_fn:
            try:
                import inspect

                from docstring_parser import parse

                docstring = parse(node_model.execute_fn.__doc__ or "")
                sig = inspect.signature(node_model.execute_fn)

                for param_name in sig.parameters:
                    param = sig.parameters.get(param_name)
                    if param:
                        param_doc = next((p for p in docstring.params if p.arg_name == param_name), None)
                        if param_doc:
                            param_descriptions[param_name] = param_doc.description or ""
                            param_types[param_name] = param_doc.type_name or ""
            except Exception as e:
                logger.debug(f"Could not parse docstring for parameter tooltips: {e}")

        for name, attr in node_model.parameters.items():
            try:
                # Handle both object attributes and plain values
                if hasattr(attr, 'value'):
                    widget_type = getattr(attr, "widget", "text") or "text"
                    param_value = attr.value
                    transformed_params[name] = {
                        "widget": widget_type,
                        "value": param_value,
                        "options": getattr(attr, "options", None),
                        "source": getattr(attr, "source", None),
                        "extractor": getattr(attr, "extractor", None),
                        "range": getattr(attr, "range", None),
                        "description": param_descriptions.get(name, ""),
                        "type": param_types.get(name, ""),
                    }
                else:
                    # Plain value, wrap it
                    transformed_params[name] = {
                        "widget": "text",
                        "value": attr,
                        "options": None,
                        "description": param_descriptions.get(name, ""),
                        "type": param_types.get(name, ""),
                    }
            except Exception as e:
                logger.warning(f"Error transforming parameter {name}: {e}", exc_info=True)
                transformed_params[name] = {
                    "widget": "text",
                    "value": None,
                    "options": None,
                    "description": param_descriptions.get(name, ""),
                    "type": param_types.get(name, ""),
                }

        serialized["parameters"] = transformed_params

        # Transform sockets: data_type -> type, and add description/description_type from model
        input_sockets = serialized.get("input_sockets") or []
        output_sockets = serialized.get("output_sockets") or []

        # Add description fields from socket models (like desktop version)
        for i, socket_model in enumerate(node_model.input_sockets):
            if i < len(input_sockets) and isinstance(input_sockets[i], dict):
                input_sockets[i]["type"] = input_sockets[i].pop("data_type", "any") or "any"
                input_sockets[i]["description"] = getattr(socket_model, "description", None) or ""
                input_sockets[i]["description_type"] = getattr(socket_model, "description_type", None) or ""

        for i, socket_model in enumerate(node_model.output_sockets):
            if i < len(output_sockets) and isinstance(output_sockets[i], dict):
                output_sockets[i]["type"] = output_sockets[i].pop("data_type", "any") or "any"
                output_sockets[i]["description"] = getattr(socket_model, "description", None) or ""
                output_sockets[i]["description_type"] = getattr(socket_model, "description_type", None) or ""

        serialized["input_sockets"] = input_sockets
        serialized["output_sockets"] = output_sockets

        # Ensure is_script is included
        serialized["is_script"] = getattr(node_model, "is_script", False)

        # Ensure hide_for_presentation is included
        serialized["hide_for_presentation"] = getattr(node_model, "hide_for_presentation", False)

        return serialized
    except Exception as e:
        logger.error(f"Error transforming node for frontend: {e}")
        # Return minimal valid structure
        return {
            "id": getattr(node_model, "id", "unknown"),
            "title": getattr(node_model, "title", "Error Node"),
            "library_name": getattr(node_model, "library_name", "unknown"),
            "pos_x": getattr(node_model, "pos_x", 0),
            "pos_y": getattr(node_model, "pos_y", 0),
            "input_sockets": [],
            "output_sockets": [],
            "parameters": {},
        }


@app.post("/api/nodes")
async def create_node(request: CreateNodeRequest, ):
    """Create a new node."""
    scene_controller = get_local_scene_controller()

    node_type_normalized = (request.node_type or "").strip()

    # Special handling for internal Display nodes (not part of library_model)
    is_display = node_type_normalized.lower() == "display"

    if is_display:
        from sciplex_core.model.node_model import NodeModel
        # Create display node with a pass-through execute function
        def display_execute(data):
            """Pass-through function for display - just returns input."""
            return data

        node_model = NodeModel(
            title="Display",
            icon="",
            parameters={},
            inputs=[("data", None)],  # None type acts as wildcard - accepts any data type
            outputs=[],
            library_name="Display",
        )
        # Set execute function for display nodes
        node_model._execute_fn = display_execute
    else:
        result = scene_controller.create_node_model(request.node_type)

        if not result.success:
            logger.error(f"create_node failed: {result.message}")
            raise HTTPException(status_code=400, detail=result.message)

        node_model = result.data
    node_model.update_position(request.position.x, request.position.y)
    scene_controller.add_node_model(node_model)

    # Note: Don't emit WebSocket event here - the API response already
    # returns the node data to the caller. WebSocket events are for
    # notifying OTHER clients in multi-user scenarios.

    return {
        "success": True,
        "node": transform_node_for_frontend(node_model)
    }


@app.post("/api/nodes/from-code")
async def create_node_from_code(request: CreateNodeFromCodeRequest, ):
    """Build a graph from Python code (supports multiple functions like desktop version)."""
    scene_controller = get_local_scene_controller()

    # Use build_graph_from_python_code to support multiple functions
    origin_pos = (request.position.x, request.position.y)
    result = scene_controller.build_graph_from_python_code(request.code.strip(), origin_pos)

    if not result.success:
        raise HTTPException(
            status_code=400,
            detail=result.message or "Failed to build graph from code"
        )

    return {
        "success": True,
        "message": result.message or "Graph built successfully"
    }


@app.delete("/api/nodes/{node_id}")
async def delete_node(node_id: str, ):
    """Delete a node."""
    scene_controller = get_local_scene_controller()

    if not scene_controller.model.graph:
        raise HTTPException(status_code=404, detail="Graph not found")

    # Find node by ID
    node_model = None
    for node in scene_controller.model.graph.nodes:
        if node.id == node_id:
            node_model = node
            break

    if not node_model:
        raise HTTPException(status_code=404, detail="Node not found")

    scene_controller.remove_node_model(node_model)

    return {"success": True}


@app.put("/api/nodes/{node_id}/position")
async def update_node_position(node_id: str, position: NodePosition, ):
    """Update a node's position."""
    scene_controller = get_local_scene_controller()

    if not scene_controller.model.graph:
        raise HTTPException(status_code=404, detail="Graph not found")

    for node in scene_controller.model.graph.nodes:
        if node.id == node_id:
            scene_controller.update_node_position(node, position.x, position.y)
            return {"success": True}

    raise HTTPException(status_code=404, detail="Node not found")


class NodeSize(BaseModel):
    width: Optional[float] = None
    height: Optional[float] = None


@app.put("/api/nodes/{node_id}/size")
async def update_node_size(node_id: str, size: NodeSize, ):
    """Update a node's size (for resizable nodes like Display nodes)."""
    scene_controller = get_local_scene_controller()

    if not scene_controller.model.graph:
        raise HTTPException(status_code=404, detail="Graph not found")

    for node in scene_controller.model.graph.nodes:
        if node.id == node_id:
            if size.width is not None:
                node.width = size.width
            if size.height is not None:
                node.height = size.height
            return {"success": True}

    raise HTTPException(status_code=404, detail="Node not found")


def resolve_workspace_path(value: Any) -> Any:
    """Resolve workspace:// paths to actual file paths.

    Supports both flat paths (workspace://file.csv) and folder paths (workspace://folder/file.csv).
    """
    if isinstance(value, str) and value.startswith("workspace://"):
        path = value.replace("workspace://", "")
        files_dir = get_workspace_files_dir()
        # Handle folder paths (e.g., "folder/file.csv")
        return str(files_dir / path)
    return value


def resolve_filesave_path(value: Any) -> Any:
    """
    Resolve filesave widget values to workspace directory.

    If value is a simple filename (no directory separators), prepend workspace files directory.
    Otherwise, return the value as-is (allows full paths).
    """
    if not isinstance(value, str) or not value:
        return value

    import os
    original_value = value
    path = value.strip()

    logger.debug(f"resolve_filesave_path: input='{original_value}', stripped='{path}'")

    # Normalize path separators for checking
    path_normalized = path.replace('\\', '/')

    # Check if it's a simple filename (not absolute, no separators, no drive letter)
    is_simple_filename = (
        path and
        not os.path.isabs(path) and
        '/' not in path_normalized and
        ':' not in path  # Windows drive letter
    )

    logger.debug(f"resolve_filesave_path: is_simple_filename={is_simple_filename}, path_normalized='{path_normalized}'")

    if is_simple_filename:
        # Prepend workspace files directory
        files_dir = get_workspace_files_dir()
        files_dir.mkdir(parents=True, exist_ok=True)
        resolved = str(files_dir / path)
        logger.debug(f"resolve_filesave_path: resolved '{path}' -> '{resolved}'")
        return resolved

    logger.debug(f"resolve_filesave_path: returning as-is: '{path}'")
    return value


def resolve_node_filesave_parameters(node_model) -> None:
    """
    Resolve all filesave widget parameters in a node to workspace paths.
    This should be called before node execution.
    """
    for param_name, param_attr in node_model.parameters.items():
        if hasattr(param_attr, 'widget') and param_attr.widget == 'filesave':
            if hasattr(param_attr, 'value'):
                original_value = param_attr.value
                logger.info(f"Resolving filesave parameter '{param_name}': original value='{original_value}' (type: {type(original_value)})")
                resolved_value = resolve_filesave_path(original_value)
                if resolved_value != original_value:
                    logger.info(f"Resolved filesave parameter '{param_name}': '{original_value}' -> '{resolved_value}'")
                    param_attr.value = resolved_value
                else:
                    logger.info(f"Filesave parameter '{param_name}' unchanged: '{original_value}'")


@app.put("/api/nodes/{node_id}/parameter")
async def update_node_parameter(node_id: str, request: UpdateParameterRequest, ):
    """Update a node's parameter value."""
    scene_controller = get_local_scene_controller()

    if not scene_controller.model.graph:
        raise HTTPException(status_code=404, detail="Graph not found")

    logger.info(f"update_node_parameter: node_id={node_id}, param_name={request.parameter_name}, value='{request.value}' (type: {type(request.value)})")

    # Resolve workspace:// paths
    resolved_value = resolve_workspace_path(request.value)

    for node in scene_controller.model.graph.nodes:
        if node.id == node_id:
            if request.parameter_name in node.parameters:
                param_attr = node.parameters[request.parameter_name]
                logger.info(f"Found parameter '{request.parameter_name}' with widget='{getattr(param_attr, 'widget', 'unknown')}', current value='{getattr(param_attr, 'value', None)}'")

                # Parse pylineedit values (Python literals like True, False, [1,2,3], etc.)
                if param_attr.widget == "pylineedit" and isinstance(resolved_value, str):
                    import ast
                    expr_str = resolved_value.strip()

                    # Try to parse as Python literal first (True, False, numbers, lists, strings, etc.)
                    try:
                        parsed_value = ast.literal_eval(expr_str)
                        param_attr.value = parsed_value
                    except (ValueError, SyntaxError):
                        # If literal_eval fails, try to evaluate as expression with workspace variables
                        # This handles cases like "2*a" where 'a' is a workspace variable
                        try:
                            import numpy as np
                            import pandas as pd
                            from sciplex_core.utils.functions import (
                                SafeEvaluator,
                                variables_registry,
                            )

                            # Build namespace with workspace variables and allowed modules
                            namespace = dict(getattr(variables_registry, "data", {}) or {})
                            namespace.update({"pd": pd, "np": np})

                            # Handle "y=2*x" style by extracting right side
                            if "=" in expr_str:
                                parts = expr_str.split("=", 1)
                                if len(parts) == 2 and parts[0].strip().isidentifier():
                                    expr_str = parts[1].strip()

                            # Parse and evaluate the expression with workspace variables
                            tree = ast.parse(expr_str, mode='eval')
                            evaluator = SafeEvaluator(namespace)
                            parsed_value = evaluator.visit(tree)
                            param_attr.value = parsed_value
                        except Exception as expr_error:
                            # Store the raw string value even if validation fails
                            # This allows execution to detect and fail on invalid values
                            param_attr.value = resolved_value
                            # Raise an error to notify the frontend
                            raise HTTPException(
                                status_code=400,
                                detail=f"Invalid Python expression: '{resolved_value}'. "
                                       f"Expected a Python literal (e.g., True, False, 123, [1,2,3], \"text\") "
                                       f"or a valid expression with workspace variables. "
                                       f"Error: {str(expr_error)}"
                            )
                elif param_attr.widget == "doublespinbox" and isinstance(resolved_value, (int, float)):
                    # Ensure doublespinbox values are always floats (not ints)
                    param_attr.value = float(resolved_value)
                elif param_attr.widget == "spinbox" and isinstance(resolved_value, (int, float)):
                    # Ensure spinbox values are always integers
                    param_attr.value = int(resolved_value)
                else:
                    param_attr.value = resolved_value

                return {"success": True}
            else:
                raise HTTPException(status_code=400, detail="Parameter not found")

    raise HTTPException(status_code=404, detail="Node not found")


class UpdateScriptCodeRequest(BaseModel):
    code: str


@app.put("/api/nodes/{node_id}/script-code")
async def update_script_node_code(node_id: str, request: UpdateScriptCodeRequest, ):
    """Update a script node's code and rebuild its sockets."""
    scene_controller = get_local_scene_controller()

    if not scene_controller.model.graph:
        raise HTTPException(status_code=404, detail="Graph not found")

    for node in scene_controller.model.graph.nodes:
        if node.id == node_id:
            if not node.is_script:
                raise HTTPException(status_code=400, detail="Node is not a script node")

            # Update the code
            if "function" not in node.parameters:
                raise HTTPException(status_code=400, detail="Script node missing function parameter")

            node.parameters["function"].value = request.code

            # Rebuild sockets from the new code
            result = node.rebuild_sockets_from_code()

            if not result.get("success"):
                return {
                    "success": False,
                    "message": result.get("message", "Failed to parse code"),
                    "node": None
                }

            # Return the updated node data
            return {
                "success": True,
                "message": f"Script node updated: {result.get('function_name', 'Script')}",
                "node": transform_node_for_frontend(node)
            }

    raise HTTPException(status_code=404, detail="Node not found")


@app.post("/api/nodes/{node_id}/toggle-hide-presentation")
async def toggle_node_hide_presentation(node_id: str, ):
    """Toggle the hide_for_presentation flag for a node."""
    logger.info(f"toggle_node_hide_presentation called with node_id: {node_id}")

    scene_controller = get_local_scene_controller()

    if not scene_controller.model.graph:
        logger.warning("Graph not found in toggle_node_hide_presentation")
        raise HTTPException(status_code=404, detail="Graph not found")

    logger.info(f"Searching for node {node_id} in {len(scene_controller.model.graph.nodes)} nodes")
    logger.info(f"Available node IDs: {[n.id for n in scene_controller.model.graph.nodes]}")

    for node in scene_controller.model.graph.nodes:
        if node.id == node_id:
            # Toggle the flag
            node.hide_for_presentation = not getattr(node, "hide_for_presentation", False)
            logger.info(f"Toggled hide_for_presentation for node {node_id} to {node.hide_for_presentation}")

            return {
                "success": True,
                "message": f"Node {'hidden' if node.hide_for_presentation else 'shown'} in presentation mode",
                "hide_for_presentation": node.hide_for_presentation
            }

    logger.warning(f"Node {node_id} not found")
    raise HTTPException(status_code=404, detail="Node not found")


# ============================================================================
# Preview / Data Inspection Endpoints
# ============================================================================

def _find_socket_by_id(socket_id: str, scene_controller: SceneController) -> Optional[SocketModel]:
    """
    Find a socket by its ID in the current graph.

    We don't require the caller to distinguish between input/output sockets;
    we just search all sockets and return the first match.
    """
    if not scene_controller or not scene_controller.model.graph:
        return None

    graph = scene_controller.model.graph
    for node in graph.nodes:
        for socket in list(getattr(node, "output_sockets", []) or []):
            if socket.id == socket_id:
                return socket
        for socket in list(getattr(node, "input_sockets", []) or []):
            if socket.id == socket_id:
                return socket
    return None


def _serialize_preview_data(
    value: Any,
    offset: int,
    limit: int,
    max_cols: int = 50,
) -> Dict[str, Any]:
    """
    Convert arbitrary Python data to a JSON-serializable preview structure.

    - DataFrame/Series/ndarray/list -> table-like preview with paging
    - Scalars -> single value preview
    """
    # Handle pandas DataFrame / Series
    if isinstance(value, pd.DataFrame):
        total_rows, total_cols = value.shape
        start = max(0, offset)
        end = min(total_rows, start + limit)
        preview_df = value.iloc[start:end].copy()

        # Column limit
        truncated_cols = False
        if preview_df.shape[1] > max_cols:
            preview_df = preview_df.iloc[:, :max_cols]
            truncated_cols = True

        # Include index as first column
        index_slice = preview_df.index
        # Reset index to make it a regular column, then add it back as first column
        preview_df_with_index = preview_df.copy()
        preview_df_with_index.insert(0, 'Index', index_slice)

        return {
            "kind": "table",
            "columns": ['Index'] + list(preview_df.columns.astype(str)),
            "rows": preview_df_with_index.astype(object).where(pd.notnull(preview_df_with_index), None).values.tolist(),
            "total_rows": int(total_rows),
            "total_cols": int(total_cols),
            "offset": int(start),
            "limit": int(limit),
            "truncated_rows": end < total_rows,
            "truncated_cols": truncated_cols,
        }

    if isinstance(value, pd.Series):
        # Display Series as a table with index and values
        total_rows = len(value)
        start = max(0, offset)
        end = min(total_rows, start + limit)

        # Use the Series index directly
        index_slice = value.index[start:end]
        values_slice = value.iloc[start:end]

        # Build rows: each row is [index_value, value]
        rows = [[idx, val] for idx, val in zip(index_slice, values_slice)]

        return {
            "kind": "table",
            "columns": ["Index", "Value"],
            "rows": rows,
            "total_rows": int(total_rows),
            "total_cols": 2,
            "offset": int(start),
            "limit": int(limit),
            "truncated_rows": end < total_rows,
            "truncated_cols": False,
        }

    # NumPy arrays
    if isinstance(value, np.ndarray):
        # For 1D/2D arrays, treat as table; higher dims -> summary
        if value.ndim == 1:
            df = pd.DataFrame({"value": value})
            return _serialize_preview_data(df, offset, limit, max_cols)
        elif value.ndim == 2:
            df = pd.DataFrame(value)
            return _serialize_preview_data(df, offset, limit, max_cols)
        else:
            flat = value.reshape(value.shape[0], -1)
            df = pd.DataFrame(flat)
            preview = _serialize_preview_data(df, offset, limit, max_cols)
            preview["shape"] = list(value.shape)
            return preview

    # Lists of lists -> try to interpret as table
    if isinstance(value, list):
        try:
            df = pd.DataFrame(value)
            return _serialize_preview_data(df, offset, limit, max_cols)
        except Exception:
            # Fallback: scalar-ish / simple list
            total = len(value)
            start = max(0, offset)
            end = min(total, start + limit)
            slice_ = value[start:end]
            return {
                "kind": "array",
                "values": slice_,
                "total": int(total),
                "offset": int(start),
                "limit": int(limit),
                "truncated": end < total,
            }

    # Scalars or everything else
    return {
        "kind": "scalar",
        "value": value,
        "type": type(value).__name__,
    }


@app.get("/api/preview")
async def preview_data(
    node_id: str = Query(..., description="ID of the upstream node that produced the data"),
    socket_id: str = Query(..., description="ID of the output socket carrying the data"),
    offset: int = Query(0, ge=0, description="Row offset for tabular data"),
    limit: int = Query(50, ge=1, le=500, description="Max rows to return for tabular data"),
):
    """
    Preview data from a node's output socket.

    - For tables/arrays: returns a window of rows (with pagination info).
    - For scalars: returns the value directly.

    NOTE: The node must have been executed so that the socket holds data.
    """
    scene_controller = get_local_scene_controller()

    if not scene_controller.model.graph:
        raise HTTPException(status_code=404, detail="Graph not initialized")

    # Find node and verify it exists
    graph = scene_controller.model.graph
    node = next((n for n in graph.nodes if n.id == node_id), None)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    # Find the socket and get its data
    socket = _find_socket_by_id(socket_id, scene_controller)
    if not socket:
        raise HTTPException(status_code=404, detail="Socket not found")

    value = socket.get_data()
    if value is None:
        raise HTTPException(status_code=400, detail="No data available on this socket. Execute the node first.")

    try:
        preview = _serialize_preview_data(value, offset=offset, limit=limit)
    except Exception as e:
        logger.error(f"Error serializing preview data: {e}")
        raise HTTPException(status_code=500, detail="Failed to serialize preview data")

    return preview


@app.get("/api/preview/csv")
async def preview_data_csv(
    node_id: str = Query(..., description="ID of the upstream node that produced the data"),
    socket_id: str = Query(..., description="ID of the output socket carrying the data"),
):
    """
    Download the full tabular data from a node's output socket as CSV.

    For non-tabular data, this returns a simple one-column CSV representation.
    """
    scene_controller = get_local_scene_controller()

    if not scene_controller.model.graph:
        raise HTTPException(status_code=404, detail="Graph not initialized")

    graph = scene_controller.model.graph
    node = next((n for n in graph.nodes if n.id == node_id), None)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    socket = _find_socket_by_id(socket_id, scene_controller)
    if not socket:
        raise HTTPException(status_code=404, detail="Socket not found")

    value = socket.get_data()
    if value is None:
        raise HTTPException(status_code=400, detail="No data available on this socket. Execute the node first.")

    # Normalize to DataFrame
    try:
        if isinstance(value, pd.DataFrame):
            df = value
        elif isinstance(value, pd.Series):
            df = value.to_frame()
        elif isinstance(value, np.ndarray):
            if value.ndim == 1:
                df = pd.DataFrame({"value": value})
            else:
                df = pd.DataFrame(value.reshape(value.shape[0], -1))
        elif isinstance(value, list):
            df = pd.DataFrame(value)
        else:
            df = pd.DataFrame({"value": [value]})
    except Exception as e:
        logger.error(f"Error normalizing data for CSV export: {e}")
        raise HTTPException(status_code=500, detail="Failed to prepare data for CSV export")

    csv_bytes = df.to_csv(index=False).encode("utf-8")
    filename = f"node_{node_id}_socket_{socket_id}.csv"

    return Response(
        content=csv_bytes,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ============================================================================
# Plot Endpoints
# ============================================================================

def _apply_matplotlib_styling(plotly_fig, mpl_fig):
    """
    Apply matplotlib styling to a Plotly figure to preserve the original appearance.

    This function ensures that matplotlib plots converted to Plotly maintain:
    - White background (matplotlib default)
    - Black text and labels
    - Proper grid styling
    - Original colors from matplotlib
    """
    try:
        # Get axes from matplotlib figure
        axes = mpl_fig.get_axes()
        if not axes:
            return

        # Extract title from matplotlib figure or first axis
        title_text = None
        title_size = 12
        try:
            if hasattr(mpl_fig, '_suptitle') and mpl_fig._suptitle:
                title_text = mpl_fig._suptitle.get_text()
                title_size = mpl_fig._suptitle.get_fontsize() or 12
            elif axes and axes[0].get_title():
                title_text = axes[0].get_title().get_text()
                title_size = axes[0].get_title().get_fontsize() or 12
        except Exception:
            pass

        # Base layout updates - matplotlib defaults
        layout_updates = {
            'paper_bgcolor': 'white',  # matplotlib default figure background
            'plot_bgcolor': 'white',  # matplotlib default plot background
            'font': {
                'family': 'Arial, sans-serif',  # Closest to matplotlib default
                'size': 10,
                'color': 'black'
            },
        }

        if title_text:
            layout_updates['title'] = {
                'text': title_text,
                'font': {
                    'size': title_size,
                    'color': 'black'
                },
                'x': 0.5,
                'xanchor': 'center'
            }

        plotly_fig.update_layout(**layout_updates)

        # Update each axis to match matplotlib styling
        for i, ax in enumerate(axes):
            # Check if grid is enabled - matplotlib often has grid enabled
            grid_visible = True
            try:
                if hasattr(ax, '_gridOnMajor'):
                    grid_visible = ax._gridOnMajor
                elif hasattr(ax, 'gridlines') and ax.gridlines:
                    grid_visible = True
            except Exception:
                pass

            # Matplotlib default grid: light gray, slightly transparent
            grid_color = 'rgba(0, 0, 0, 0.15)'

            # Get axis labels
            xlabel = ax.get_xlabel()
            ylabel = ax.get_ylabel()

            # Determine axis reference for subplots
            row_num = i + 1 if len(axes) > 1 else None

            # Update x-axis with matplotlib-like styling
            xaxis_update = {
                'showgrid': grid_visible,
                'gridcolor': grid_color,
                'gridwidth': 1,
                'zeroline': False,
                'showline': True,
                'linecolor': 'black',
                'linewidth': 1,
                'tickfont': {'color': 'black', 'size': 10},
                'tickcolor': 'black',
            }
            if xlabel:
                xaxis_update['title'] = {
                    'text': xlabel,
                    'font': {'color': 'black', 'size': 12}
                }

            if row_num:
                plotly_fig.update_xaxes(**xaxis_update, row=row_num, col=1)
            else:
                plotly_fig.update_xaxes(**xaxis_update)

            # Update y-axis with matplotlib-like styling
            yaxis_update = {
                'showgrid': grid_visible,
                'gridcolor': grid_color,
                'gridwidth': 1,
                'zeroline': False,
                'showline': True,
                'linecolor': 'black',
                'linewidth': 1,
                'tickfont': {'color': 'black', 'size': 10},
                'tickcolor': 'black',
            }
            if ylabel:
                yaxis_update['title'] = {
                    'text': ylabel,
                    'font': {'color': 'black', 'size': 12}
                }

            if row_num:
                plotly_fig.update_yaxes(**yaxis_update, row=row_num, col=1)
            else:
                plotly_fig.update_yaxes(**yaxis_update)

        # Note: mpl_to_plotly should preserve trace colors automatically
        # If colors are still wrong, we might need to manually extract and apply them

    except Exception as e:
        logger.warning(f"Could not fully apply matplotlib styling: {e}")
        import traceback
        logger.debug(traceback.format_exc())
        # Continue anyway - the conversion will still work, just without perfect styling


@app.get("/api/socket-data")
async def get_socket_data(
    node_id: str = Query(..., description="ID of the upstream node that produced the data"),
    socket_id: str = Query(..., description="ID of the output socket carrying the data"),
):
    """
    Get data from a node's output socket and determine its type.
    
    Returns information about the data type and the data itself (serialized appropriately).
    """
    scene_controller = get_local_scene_controller()

    if not scene_controller.model.graph:
        raise HTTPException(status_code=404, detail="Graph not initialized")

    # Find the socket and get its data
    socket = _find_socket_by_id(socket_id, scene_controller)
    if not socket:
        raise HTTPException(status_code=404, detail="Socket not found")

    value = socket.get_data()
    if value is None:
        raise HTTPException(status_code=400, detail="No data available on this socket. Execute the node first.")

    try:
        # Check if it's a matplotlib Figure
        from matplotlib.figure import Figure as MplFigure
        if isinstance(value, MplFigure):
            # Convert matplotlib to Plotly
            try:
                # Try the modern approach first (plotly >= 5.0)
                try:
                    from plotly.tools import mpl_to_plotly
                    plotly_fig = mpl_to_plotly(value)
                except ImportError:
                    # Fallback to older import style
                    import plotly.tools as pt
                    if hasattr(pt, 'mpl_to_plotly'):
                        plotly_fig = pt.mpl_to_plotly(value)
                    else:
                        raise ImportError("mpl_to_plotly not found in plotly.tools")

                # Apply matplotlib styling to preserve appearance
                _apply_matplotlib_styling(plotly_fig, value)

                return {
                    "success": True,
                    "data_type": "plot",
                    "plot_type": "matplotlib",
                    "figure": plotly_fig.to_dict()
                }
            except ImportError:
                raise HTTPException(
                    status_code=500,
                    detail="Plotly is required to convert matplotlib figures. Install with: pip install plotly"
                )
            except Exception as e:
                logger.error(f"Error converting matplotlib figure to Plotly: {e}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to convert matplotlib figure: {str(e)}"
                )

        # Check if it's a Plotly figure
        try:
            import plotly.graph_objects as go
            if isinstance(value, go.Figure):
                return {
                    "success": True,
                    "data_type": "plot",
                    "plot_type": "plotly",
                    "figure": value.to_dict()
                }
        except ImportError:
            pass
        except Exception as e:
            logger.error(f"Error exporting Plotly figure: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to export Plotly figure: {str(e)}"
            )

        # Check if it's tabular data (DataFrame, Series, ndarray)
        if isinstance(value, pd.DataFrame) or isinstance(value, pd.Series) or isinstance(value, np.ndarray):
            # Use the preview serialization function
            preview = _serialize_preview_data(value, offset=0, limit=1000, max_cols=100)
            return {
                "success": True,
                "data_type": "table",
                "preview": preview
            }

        # Check if it's a dict
        if isinstance(value, dict):
            # Serialize dict (convert values to strings for display)
            from pprint import pformat
            return {
                "success": True,
                "data_type": "dict",
                "data": {k: pformat(v) for k, v in value.items()}
            }

        # Check if it's a scalar (number, string, bool)
        import numbers
        if isinstance(value, (numbers.Number, str, bool, list)):
            return {
                "success": True,
                "data_type": "scalar",
                "value": value,
                "type": type(value).__name__
            }

        # Unknown type
        return {
            "success": True,
            "data_type": "unknown",
            "value": str(value),
            "type": type(value).__name__
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting socket data: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get socket data: {str(e)}")


@app.get("/api/plot")
async def get_plot_data(
    node_id: str = Query(..., description="ID of the upstream node that produced the plot"),
    socket_id: str = Query(..., description="ID of the output socket carrying the plot data"),
):
    """
    Get plot data from a node's output socket (legacy endpoint, redirects to /api/socket-data).
    
    Supports:
    - Matplotlib Figure objects (converted to Plotly)
    - Plotly figure objects (exported directly)
    
    Returns a Plotly JSON figure that can be rendered in the browser.
    """
    # Redirect to socket-data endpoint and extract plot info
    socket_data = await get_socket_data(node_id=node_id, socket_id=socket_id)

    if socket_data.get("data_type") != "plot":
        raise HTTPException(
            status_code=400,
            detail=f"Socket data is not a plot. Got {socket_data.get('data_type', 'unknown')}"
        )

    return {
        "success": True,
        "plot_type": socket_data.get("plot_type"),
        "figure": socket_data.get("figure")
    }


@app.get("/api/plot/thumbnail")
async def get_plot_thumbnail(
    node_id: str = Query(..., description="ID of the upstream node that produced the plot"),
    socket_id: str = Query(..., description="ID of the output socket carrying the plot data"),
    width: int = Query(400, description="Thumbnail width in pixels"),
    height: int = Query(300, description="Thumbnail height in pixels"),
    scale: float = Query(1.0, description="Image scale factor"),
):
    """
    Get a plot as a thumbnail PNG image for preview.
    
    Supports:
    - Matplotlib Figure objects (converted to Plotly then to PNG)
    - Plotly figure objects (converted directly to PNG)
    
    Returns a smaller, optimized thumbnail for fast loading in the flow canvas.
    
    Note: Requires the 'kaleido' package to be installed for image export.
    If kaleido is not available, this endpoint will return a 503 error.
    """
    import plotly.graph_objects as go

    # Check if kaleido is available
    if importlib.util.find_spec("kaleido") is None:
        logger.warning("kaleido package is not installed. Install it with: pip install kaleido")
        raise HTTPException(
            status_code=503,
            detail="Thumbnail generation requires the 'kaleido' package. Please install it with: pip install kaleido"
        )

    # Get plot data
    socket_data = await get_socket_data(node_id=node_id, socket_id=socket_id)

    if socket_data.get("data_type") != "plot":
        raise HTTPException(
            status_code=400,
            detail=f"Socket data is not a plot. Got {socket_data.get('data_type', 'unknown')}"
        )

    figure_dict = socket_data.get("figure")
    if not figure_dict:
        raise HTTPException(status_code=400, detail="No figure data available")

    try:
        # Reconstruct Plotly figure from dict
        fig = go.Figure(figure_dict)

        # Get plot type from socket data
        plot_type = socket_data.get("plot_type", "plotly")

        # Match the frontend PlotRenderer logic exactly for background colors
        # For matplotlib plots: preserve white background (no changes)
        # For plotly plots: use dark theme background (#121218) matching Display node
        if plot_type == "plotly":
            layout_dict = figure_dict.get("layout", {})

            # Get existing background colors, or use dark theme default
            # Replace white backgrounds with dark theme
            paper_bg = layout_dict.get("paper_bgcolor")
            plot_bg = layout_dict.get("plot_bgcolor")

            # Convert white/None to dark theme, otherwise preserve existing color
            if not paper_bg or paper_bg == "white" or paper_bg == "#ffffff" or paper_bg == "#FFFFFF":
                paper_bg = "#121218"
            if not plot_bg or plot_bg == "white" or plot_bg == "#ffffff" or plot_bg == "#FFFFFF":
                plot_bg = "#121218"

            fig.update_layout(
                paper_bgcolor=paper_bg,
                plot_bgcolor=plot_bg,
            )

            # Update font colors for dark theme if not explicitly set
            font_dict = layout_dict.get("font", {})
            if not font_dict or not font_dict.get("color"):
                # Get current font properties safely
                font_color = "#e5e7eb"
                font_size = 10

                # Try to get existing font properties from the figure
                if hasattr(fig.layout, 'font') and fig.layout.font:
                    try:
                        # If font is a dict-like object, try to get size
                        if hasattr(fig.layout.font, 'size') and fig.layout.font.size:
                            font_size = fig.layout.font.size
                    except (AttributeError, TypeError):
                        pass

                # Update font with proper dictionary format
                fig.update_layout(font={"color": font_color, "size": font_size})

            # Update axis grid colors for dark theme if not explicitly set
            xaxis_dict = layout_dict.get("xaxis", {})
            if not xaxis_dict.get("gridcolor"):
                fig.update_xaxes(gridcolor="rgba(255, 255, 255, 0.1)")

            yaxis_dict = layout_dict.get("yaxis", {})
            if not yaxis_dict.get("gridcolor"):
                fig.update_yaxes(gridcolor="rgba(255, 255, 255, 0.1)")
        # For matplotlib plots, preserve the white background (no changes needed)

        # Convert to PNG bytes with smaller dimensions for thumbnail
        img_bytes = fig.to_image(format="png", width=width, height=height, scale=scale)

        # Return as PNG image response (inline, not download)
        # Disable caching to ensure fresh thumbnails are always fetched
        return Response(
            content=img_bytes,
            media_type="image/png",
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
            }
        )
    except ValueError as e:
        # Handle kaleido-related errors specifically
        if "kaleido" in str(e).lower():
            logger.error(f"Kaleido error: {e}")
            raise HTTPException(
                status_code=503,
                detail="Thumbnail generation requires the 'kaleido' package. Please install it with: pip install kaleido"
            )
        raise
    except Exception as e:
        logger.error(f"Error generating plot thumbnail: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate plot thumbnail: {str(e)}")


@app.get("/api/plot/download")
async def download_plot_as_png(
    node_id: str = Query(..., description="ID of the upstream node that produced the plot"),
    socket_id: str = Query(..., description="ID of the output socket carrying the plot data"),
):
    """
    Download a plot as PNG image.
    
    Supports:
    - Matplotlib Figure objects (converted to Plotly then to PNG)
    - Plotly figure objects (converted directly to PNG)
    
    Note: Requires the 'kaleido' package to be installed for image export.
    """
    import plotly.graph_objects as go

    # Check if kaleido is available
    if importlib.util.find_spec("kaleido") is None:
        logger.warning("kaleido package is not installed. Install it with: pip install kaleido")
        raise HTTPException(
            status_code=503,
            detail="Plot download requires the 'kaleido' package. Please install it with: pip install kaleido"
        )

    # Get plot data
    socket_data = await get_socket_data(node_id=node_id, socket_id=socket_id)

    if socket_data.get("data_type") != "plot":
        raise HTTPException(
            status_code=400,
            detail=f"Socket data is not a plot. Got {socket_data.get('data_type', 'unknown')}"
        )

    figure_dict = socket_data.get("figure")
    if not figure_dict:
        raise HTTPException(status_code=400, detail="No figure data available")

    try:
        # Reconstruct Plotly figure from dict
        fig = go.Figure(figure_dict)

        # Convert to PNG bytes
        img_bytes = fig.to_image(format="png", width=1200, height=800, scale=2)

        # Return as PNG file response
        return Response(
            content=img_bytes,
            media_type="image/png",
            headers={
                "Content-Disposition": f'attachment; filename="plot_{node_id[:8]}.png"'
            }
        )
    except ValueError as e:
        # Handle kaleido-related errors specifically
        if "kaleido" in str(e).lower():
            logger.error(f"Kaleido error: {e}")
            raise HTTPException(
                status_code=503,
                detail="Plot download requires the 'kaleido' package. Please install it with: pip install kaleido"
            )
        raise
    except Exception as e:
        logger.error(f"Error converting plot to PNG: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to convert plot to PNG: {str(e)}")


# ============================================================================
# Edge Endpoints
# ============================================================================

@app.post("/api/edges")
async def create_edge(request: CreateEdgeRequest, ):
    """Create a new edge between nodes."""
    scene_controller = get_local_scene_controller()

    if not scene_controller.model.graph:
        raise HTTPException(status_code=500, detail="Graph not initialized")

    # Find source and target sockets
    source_socket = None
    target_socket = None

    for node in scene_controller.model.graph.nodes:
        for socket in node.output_sockets:
            if socket.id == request.source_socket_id:
                source_socket = socket
        for socket in node.input_sockets:
            if socket.id == request.target_socket_id:
                target_socket = socket

    if not source_socket or not target_socket:
        raise HTTPException(status_code=404, detail="Socket not found")

    # Create edge
    result = scene_controller.validate_and_create_edge(source_socket, target_socket)

    if not result.success:
        raise HTTPException(status_code=400, detail=result.message)

    edge_model = result.data
    scene_controller.add_edge_model(edge_model)

    # Emit event
    ws_emitter.emit("edge_model_created", edge_model)

    return {
        "success": True,
        "edge": edge_model.serialize()
    }


@app.delete("/api/edges/{edge_id}")
async def delete_edge(edge_id: str, ):
    """Delete an edge."""
    scene_controller = get_local_scene_controller()

    if not scene_controller.model.graph:
        raise HTTPException(status_code=404, detail="Graph not found")

    for edge in scene_controller.model.graph.edges:
        if edge.id == edge_id:
            scene_controller.remove_edge_model(edge)
            return {"success": True}

    raise HTTPException(status_code=404, detail="Edge not found")


# ============================================================================
# Execution Endpoints
# ============================================================================

@app.post("/api/execute")
async def execute_graph():
    """Execute the entire graph."""
    scene_controller = get_local_scene_controller()

    # Resolve filesave parameters for all nodes before execution
    if scene_controller.model.graph:
        for node in scene_controller.model.graph.nodes:
            resolve_node_filesave_parameters(node)

    result = scene_controller.execute_graph()
    await emit_execution_states(scene_controller)

    return {
        "success": result.success,
        "message": result.message
    }


@app.post("/api/execute/{node_id}")
async def execute_node(node_id: str, single_node: bool = Query(False)):
    """Execute a single node or its ancestors depending on mode."""
    scene_controller = get_local_scene_controller()

    if not scene_controller.model.graph:
        raise HTTPException(status_code=404, detail="Graph not found")

    for node in scene_controller.model.graph.nodes:
        if node.id == node_id:
            # Resolve filesave parameters for the node before execution
            resolve_node_filesave_parameters(node)
            if not single_node and scene_controller.model.graph:
                # Resolve dependencies as well to keep existing behavior
                for n in scene_controller.model.graph.nodes:
                    resolve_node_filesave_parameters(n)

            if single_node:
                result = scene_controller.execute_node(node)
            else:
                result = scene_controller.execute_up_to_node(node)
            await emit_execution_states(scene_controller)

            return {
                "success": result.success,
                "message": result.message
            }

    raise HTTPException(status_code=404, detail="Node not found")


@app.post("/api/reset")
async def reset_nodes():
    """Reset all nodes."""
    scene_controller = get_local_scene_controller()

    if scene_controller:
        scene_controller.reset_all_nodes()
    return {"success": True}


@app.post("/api/nodes/{node_id}/reset")
async def reset_node(node_id: str, ):
    """Reset a single node."""
    logger.info(f"reset_node called with node_id: {node_id}")

    scene_controller = get_local_scene_controller()

    if not scene_controller.model.graph:
        logger.warning("Graph not found in reset_node")
        raise HTTPException(status_code=404, detail="Graph not found")

    logger.info(f"Searching for node {node_id} in {len(scene_controller.model.graph.nodes)} nodes")
    logger.info(f"Available node IDs: {[n.id for n in scene_controller.model.graph.nodes]}")

    for node in scene_controller.model.graph.nodes:
        if node.id == node_id:
            from sciplex_core.controller.node_controller import NodeController
            node_controller = NodeController(node)
            node_controller.reset()
            logger.info(f"Reset node {node_id} successfully")
            return {"success": True, "message": f"Node {node_id} reset successfully"}

    logger.warning(f"Node {node_id} not found for reset")
    raise HTTPException(status_code=404, detail="Node not found")


class SaveNodeToLibraryRequest(BaseModel):
    library_name: str
    is_new: bool


@app.post("/api/nodes/{node_id}/save-to-library")
async def save_node_to_library(node_id: str, request: SaveNodeToLibraryRequest, ):
    """Save a script node to a library (saves to workspace/libraries/)."""
    scene_controller = get_local_scene_controller()

    if not scene_controller.model.graph:
        raise HTTPException(status_code=404, detail="Graph not found")

    import ast

    for node in scene_controller.model.graph.nodes:
        if node.id == node_id:
            if not getattr(node, "is_script", False):
                raise HTTPException(
                    status_code=400,
                    detail="Only Script nodes can be saved to a library."
                )

            func_code = node.parameters.get("function").value if node.parameters else None
            if not func_code or "def " not in func_code:
                raise HTTPException(
                    status_code=400,
                    detail="No valid function code found."
                )

            # Extract function name from code
            func_name = node.title or "script_function"
            try:
                tree = ast.parse(func_code)
                func_def = next((n for n in tree.body if isinstance(n, ast.FunctionDef)), None)
                if func_def:
                    func_name = func_def.name
            except SyntaxError:
                pass  # fallback to node title

            # Guard against duplicate function names already registered
            if library_model.get_library_item(func_name) is not None:
                raise HTTPException(
                    status_code=400,
                    detail=f"Node name '{func_name}' already exists. Choose a different name."
                )

            # Use workspace libraries directory
            libraries_dir = get_workspace_libraries_dir()

            filename = f"{request.library_name}.py" if not request.library_name.endswith(".py") else request.library_name
            filepath = libraries_dir / filename

            # Ensure the directory is in sys.path for imports
            import sys
            if str(libraries_dir) not in sys.path:
                sys.path.insert(0, str(libraries_dir))

            header = (
                "# Auto-generated by Sciplex Script node\n"
                "import pandas as pd\n"
                "import numpy as np\n"
                "import matplotlib.pyplot as plt\n"
                "import sklearn\n\n"
            )

            if not filepath.exists():
                # Create new file with header
                with open(filepath, "w", encoding="utf-8") as f:
                    f.write(header)
                    f.write(func_code.strip() + "\n")
            else:
                # Append to existing file (don't add header)
                with open(filepath, "a", encoding="utf-8") as f:
                    f.write("\n\n")
                    f.write(f"# Added from Script node '{node.title}'\n")
                    f.write(func_code.strip() + "\n")

            # Import/reload the library so nodes are registered
            from sciplex_core.utils.library_loader import LibraryLoader
            library_loader = LibraryLoader(base_dir)
            import_result = library_loader.load_library_file(str(filepath))

            if not import_result.get("success", False):
                raise HTTPException(
                    status_code=400,
                    detail=import_result.get("message", "Failed to import library.")
                )

            return {
                "success": True,
                "message": f"Saved function '{func_name}' to {filename}.",
                "data": {"function_name": func_name, "filepath": str(filepath)}
            }

    raise HTTPException(status_code=404, detail="Node not found")


# ============================================================================
# Annotation Endpoints
# ============================================================================

class CreateAnnotationRequest(BaseModel):
    text: str = "Type Here ..."
    position: dict  # {x: float, y: float}


@app.post("/api/annotations")
async def create_annotation(request: CreateAnnotationRequest, ):
    """Create a new annotation at the specified position."""
    scene_controller = get_local_scene_controller()

    from sciplex_core.model.scene_annotation_model import SceneAnnotationModel

    annotation_model = SceneAnnotationModel(
        text=request.text,
        pos_x=request.position.get("x"),
        pos_y=request.position.get("y"),
        width=150,  # Default width
        height=50,  # Default height
    )

    scene_controller.add_annotation_model(annotation_model)

    return {
        "success": True,
        "annotation": {
            "id": annotation_model.id,
            "text": annotation_model.text,
            "pos_x": annotation_model.pos_x,
            "pos_y": annotation_model.pos_y,
            "width": annotation_model.width,
            "height": annotation_model.height,
            "is_selected": annotation_model.is_selected,
        }
    }


class UpdateAnnotationRequest(BaseModel):
    text: Optional[str] = None
    position: Optional[dict] = None  # {x: float, y: float}
    dimensions: Optional[dict] = None  # {width: float, height: float}


@app.put("/api/annotations/{annotation_id}")
async def update_annotation(annotation_id: str, request: UpdateAnnotationRequest, ):
    """Update an annotation's text, position, or dimensions."""
    scene_controller = get_local_scene_controller()

    # Find the annotation
    annotation_model = None
    for ann in scene_controller.model.scene_annotations:
        if ann.id == annotation_id:
            annotation_model = ann
            break

    if not annotation_model:
        raise HTTPException(status_code=404, detail="Annotation not found")

    # Update fields
    if request.text is not None:
        annotation_model.set_text(request.text)
    if request.position is not None:
        annotation_model.set_position(request.position.get("x"), request.position.get("y"))
    if request.dimensions is not None:
        annotation_model.set_dimensions(request.dimensions.get("width"), request.dimensions.get("height"))

    return {
        "success": True,
        "annotation": {
            "id": annotation_model.id,
            "text": annotation_model.text,
            "pos_x": annotation_model.pos_x,
            "pos_y": annotation_model.pos_y,
            "width": annotation_model.width,
            "height": annotation_model.height,
            "is_selected": annotation_model.is_selected,
        }
    }


@app.delete("/api/annotations/{annotation_id}")
async def delete_annotation(annotation_id: str, ):
    """Delete an annotation."""
    scene_controller = get_local_scene_controller()

    # Find the annotation
    annotation_model = None
    for ann in scene_controller.model.scene_annotations:
        if ann.id == annotation_id:
            annotation_model = ann
            break

    if not annotation_model:
        raise HTTPException(status_code=404, detail="Annotation not found")

    scene_controller.remove_annotation_model(annotation_model)

    return {"success": True}


# ============================================================================
# Workspace - Centralized Path Management
# ============================================================================

def get_workspace_root() -> Path:
    """Get the workspace root directory.
    
    For local mode: uses WORKSPACE_ROOT env var or ~/Sciplex/workspace/
    
    Returns:
        Path to the workspace root directory.
    """
    # Local mode: single workspace directory
    workspace_root = Path(WORKSPACE_ROOT)
    workspace_root.mkdir(parents=True, exist_ok=True)
    return workspace_root


def get_workspace_files_dir() -> Path:
    """Get or create the workspace files directory."""
    files_dir = get_workspace_root() / "files"
    files_dir.mkdir(parents=True, exist_ok=True)
    return files_dir


def get_workspace_libraries_dir() -> Path:
    """Get or create the workspace libraries directory.
    
    This is where user-uploaded .py library files are stored.
    """
    libraries_dir = get_workspace_root() / "libraries"
    libraries_dir.mkdir(parents=True, exist_ok=True)
    return libraries_dir


def get_workspace_projects_dir() -> Path:
    """Get or create the workspace projects directory.
    
    This is where saved workflows are stored as JSON files.
    """
    projects_dir = get_workspace_root() / "projects"
    projects_dir.mkdir(parents=True, exist_ok=True)
    return projects_dir


def get_workspace_icons_dir() -> Path:
    """Get or create the workspace icons directory."""
    icons_dir = get_workspace_root() / "icons"
    icons_dir.mkdir(parents=True, exist_ok=True)
    return icons_dir


def get_assets_icons_path() -> Optional[Path]:
    """Return the path to packaged icons, handling both installed and editable modes."""
    try:
        with pkg_resources.as_file(pkg_resources.files("sciplex_core") / "assets" / "icons") as assets_icons_dir:
            return assets_icons_dir
    except Exception:
        fallback = project_root / "sciplex_core" / "assets" / "icons"
        if fallback.exists():
            return fallback
    return None


def get_library_config_path() -> Path:
    """Get the path to the library configuration file."""
    return get_workspace_root() / "library_config.json"


def load_library_config() -> Dict[str, bool]:
    """Load library enabled/disabled configuration from file.
    
    Returns a dictionary mapping library paths (relative to libraries dir) to enabled state.
    Default is True (enabled) for all libraries.
    """
    config_path = get_library_config_path()
    if not config_path.exists():
        return {}

    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
            return config.get("enabled_libraries", {})
    except Exception as e:
        logger.warning(f"Error loading library config: {e}")
        return {}


def save_library_config(config: Dict[str, bool]):
    """Save library enabled/disabled configuration to file."""
    config_path = get_library_config_path()
    config_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump({"enabled_libraries": config}, f, indent=2)
    except Exception as e:
        logger.error(f"Error saving library config: {e}")
        raise


def is_library_enabled(library_path: str, library_config: Dict[str, bool]) -> bool:
    """Check if a library is enabled. Default is True if not in config."""
    return library_config.get(library_path, True)



@app.get("/api/workspace/icons")
async def list_workspace_icons():
    """List all icons in the workspace/icons folder.
    Excludes toolbar icons (those starting with 'action_') as they are UI-only icons.
    """
    icons_dir = get_workspace_icons_dir()

    icons = []
    if icons_dir.exists():
        for icon_file in sorted(icons_dir.iterdir()):
            if icon_file.is_file() and icon_file.suffix.lower() in ['.png', '.svg', '.jpg', '.jpeg']:
                # Skip toolbar icons (action_* icons are for UI only, not for nodes)
                icon_name = icon_file.stem
                if icon_name.startswith('action_'):
                    continue

                icons.append({
                    "name": icon_file.name,
                    "size": icon_file.stat().st_size,
                    "modified_time": icon_file.stat().st_mtime,
                })

    return {"icons": icons}


@app.post("/api/workspace/icons/upload")
async def upload_workspace_icons(files: List[UploadFile] = File(...), ):
    """Upload icon files to the workspace/icons folder."""
    icons_dir = get_workspace_icons_dir()

    uploaded = []
    errors = []

    for file in files:
        filename = file.filename or ""
        if not filename:
            errors.append("Missing filename")
            continue
        # Validate file extension
        if not filename.lower().endswith(('.png', '.svg', '.jpg', '.jpeg')):
            errors.append(f"{filename}: Invalid file type. Only .png, .svg, .jpg, .jpeg are allowed.")
            continue

        try:
            # Save file
            file_path = icons_dir / filename
            with open(file_path, "wb") as f:
                content = await file.read()
                f.write(content)
            uploaded.append(filename)
            logger.info(f"Uploaded icon: {filename}")
        except Exception as e:
            errors.append(f"{filename}: {str(e)}")
            logger.error(f"Error uploading icon {filename}: {e}")

    if uploaded:
        message = f"Uploaded {len(uploaded)} icon(s): {', '.join(uploaded)}"
        if errors:
            message += f". Errors: {', '.join(errors)}"
        return {"success": True, "message": message, "uploaded": uploaded, "errors": errors}
    else:
        raise HTTPException(status_code=400, detail=f"Failed to upload icons: {', '.join(errors)}")


@app.delete("/api/workspace/icons/{icon_name}")
async def delete_workspace_icon(icon_name: str, ):
    """Delete an icon from the workspace/icons folder."""
    icons_dir = get_workspace_icons_dir()
    icon_path = icons_dir / icon_name

    # Security check: ensure icon is within icons directory
    try:
        icon_path.resolve().relative_to(icons_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Invalid icon path")

    if not icon_path.exists():
        raise HTTPException(status_code=404, detail="Icon not found")

    try:
        icon_path.unlink()
        logger.info(f"Deleted icon: {icon_name}")
        return {"success": True, "message": f"Icon '{icon_name}' deleted"}
    except Exception as e:
        logger.error(f"Error deleting icon {icon_name}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete icon: {str(e)}")


@app.get("/api/script/default-code")
async def get_script_default_code():
    """Return the default template for script nodes."""
    return {"code": SCRIPT_DEFAULT_CODE}


@app.get("/api/workspace/files")
async def list_workspace_files():
    """List all files in the user's workspace, organized by folders."""
    files_dir = get_workspace_files_dir()

    if not files_dir.exists():
        return {"folders": [], "files": []}

    folders = []
    root_files = []

    # Scan directories and files
    for item in sorted(files_dir.iterdir()):
        if item.name.startswith("."):
            continue  # Skip hidden files

        # Skip __pycache__ directories
        if item.is_dir() and item.name == "__pycache__":
            continue

        if item.is_dir():
            # It's a folder - get its files
            folder_files = []
            for file_path in sorted(item.iterdir()):
                # Skip __pycache__ directories inside folders
                if file_path.is_dir() and file_path.name == "__pycache__":
                    continue
                if file_path.is_file():
                    stat = file_path.stat()
                    folder_files.append({
                        "name": file_path.name,
                        "size": stat.st_size,
                        "modified": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M"),
                        "type": file_path.suffix.lower().lstrip("."),
                        "folder": item.name,
                        "path": f"{item.name}/{file_path.name}"
                    })

            folders.append({
                "name": item.name,
                "path": str(item),
                "files": folder_files,
            })
        elif item.is_file():
            # Root level file
            stat = item.stat()
            root_files.append({
                "name": item.name,
                "size": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M"),
                "type": item.suffix.lower().lstrip("."),
                "folder": "",
                "path": item.name
            })

    return {
        "folders": folders,
        "files": root_files,  # Files at root level
    }


@app.post("/api/workspace/files/upload")
async def upload_workspace_files(files: List[UploadFile] = File(...), folder: str = Query("", description="Folder name to upload to (empty for root)")):
    """Upload files to the workspace, optionally to a specific folder."""
    files_dir = get_workspace_files_dir()
    uploaded = []

    # Allowed data file extensions
    allowed_extensions = {".csv", ".xlsx", ".xls", ".json", ".txt", ".parquet", ".tsv"}

    # Determine target directory
    if folder:
        target_dir = files_dir / folder
        target_dir.mkdir(parents=True, exist_ok=True)
    else:
        target_dir = files_dir

    for file in files:
        filename = file.filename or ""
        if not filename:
            raise HTTPException(status_code=400, detail="Missing filename")
        # Validate extension
        ext = Path(filename).suffix.lower()
        if ext not in allowed_extensions:
            raise HTTPException(
                status_code=400,
                detail=f"File type '{ext}' not allowed. Allowed: {', '.join(allowed_extensions)}"
            )

        # Save file
        file_path = target_dir / filename

        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)

        uploaded.append(filename)

    return {
        "message": f"Uploaded {len(uploaded)} file(s)",
        "files": uploaded
    }


class CreateFolderRequest(BaseModel):
    name: str


@app.get("/api/workspace/files/{filepath:path}/download")
async def download_workspace_file(filepath: str, ):
    """Download a file from the workspace. Supports folder paths (e.g., folder/file.csv)."""
    files_dir = get_workspace_files_dir()
    file_path = files_dir / filepath

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    if not file_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    # Security check: ensure file is within workspace
    try:
        file_path.resolve().relative_to(files_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")

    # Determine media type based on file extension
    media_type = "application/octet-stream"
    if filepath.endswith(".csv"):
        media_type = "text/csv"
    elif filepath.endswith((".xlsx", ".xls")):
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    elif filepath.endswith(".json"):
        media_type = "application/json"
    elif filepath.endswith(".txt"):
        media_type = "text/plain"
    elif filepath.endswith(".parquet"):
        media_type = "application/octet-stream"

    return FileResponse(
        path=str(file_path),
        filename=file_path.name,
        media_type=media_type
    )


@app.post("/api/workspace/files/folders")
async def create_files_folder(request: CreateFolderRequest, ):
    """Create a new folder in the workspace files directory."""
    files_dir = get_workspace_files_dir()

    # Validate folder name
    folder_name = request.name.strip()
    if not folder_name or "/" in folder_name or "\\" in folder_name:
        raise HTTPException(status_code=400, detail="Invalid folder name")

    folder_path = files_dir / folder_name

    if folder_path.exists():
        raise HTTPException(status_code=400, detail="Folder already exists")

    folder_path.mkdir(exist_ok=True)

    return {"success": True, "message": f"Created folder '{folder_name}'", "name": folder_name}


class MoveFileRequest(BaseModel):
    target_folder: str = ""  # Empty string for root level


@app.post("/api/workspace/files/{filepath:path}/move")
async def move_file(filepath: str, request: MoveFileRequest):
    """Move a file to a different folder. Supports folder paths (e.g., folder/file.csv)."""
    files_dir = get_workspace_files_dir()
    source_path = files_dir / filepath

    if not source_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    if not source_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    # Security check: ensure source is within workspace
    try:
        source_path.resolve().relative_to(files_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Invalid file path")

    # Determine target directory
    if request.target_folder:
        target_dir = files_dir / request.target_folder
        if not target_dir.exists() or not target_dir.is_dir():
            raise HTTPException(status_code=404, detail="Target folder not found")
        target_path = target_dir / source_path.name
    else:
        # Move to root
        target_path = files_dir / source_path.name

    # Check if target already exists
    if target_path.exists():
        raise HTTPException(status_code=409, detail="File already exists in target location")

    # Security check: ensure target is within workspace
    try:
        target_path.resolve().relative_to(files_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Invalid target path")

    # Move the file
    import shutil
    shutil.move(str(source_path), str(target_path))

    logger.info(f"Moved file from {filepath} to {target_path.relative_to(files_dir)}")

    return {
        "success": True,
        "message": "File moved successfully",
        "new_path": str(target_path.relative_to(files_dir)).replace("\\", "/")
    }


class RenameRequest(BaseModel):
    new_name: str


class DuplicateRequest(BaseModel):
    new_name: str = ""  # Optional, will auto-generate if empty


@app.post("/api/workspace/files/{filepath:path}/rename")
async def rename_file(filepath: str, request: RenameRequest):
    """Rename a file. Supports folder paths (e.g., folder/file.csv)."""
    files_dir = get_workspace_files_dir()
    source_path = files_dir / filepath

    if not source_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    if not source_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    # Security check
    try:
        source_path.resolve().relative_to(files_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Invalid file path")

    # Validate new name
    new_name = request.new_name.strip()
    if not new_name or "/" in new_name or "\\" in new_name:
        raise HTTPException(status_code=400, detail="Invalid file name")

    # Determine target path (same directory, new name)
    target_path = source_path.parent / new_name

    if target_path.exists():
        raise HTTPException(status_code=409, detail="File with this name already exists")

    # Rename
    source_path.rename(target_path)

    new_relative_path = str(target_path.relative_to(files_dir)).replace("\\", "/")
    logger.info(f"Renamed file from {filepath} to {new_relative_path}")

    return {
        "success": True,
        "message": "File renamed successfully",
        "new_path": new_relative_path
    }


@app.post("/api/workspace/files/{filepath:path}/duplicate")
async def duplicate_file(filepath: str, request: DuplicateRequest = DuplicateRequest()):
    """Duplicate a file. Supports folder paths (e.g., folder/file.csv)."""
    files_dir = get_workspace_files_dir()
    source_path = files_dir / filepath

    if not source_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    if not source_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")

    # Security check
    try:
        source_path.resolve().relative_to(files_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Invalid file path")

    # Generate new name if not provided
    if request.new_name:
        new_name = request.new_name.strip()
        if "/" in new_name or "\\" in new_name:
            raise HTTPException(status_code=400, detail="Invalid file name")
    else:
        # Auto-generate name: "file.csv" -> "file_copy.csv" or "file (1).csv"
        stem = source_path.stem
        suffix = source_path.suffix
        base_name = f"{stem}_copy{suffix}"
        counter = 1
        while (source_path.parent / base_name).exists():
            base_name = f"{stem} ({counter}){suffix}"
            counter += 1
        new_name = base_name

    # Determine target path
    target_path = source_path.parent / new_name

    if target_path.exists():
        raise HTTPException(status_code=409, detail="File with this name already exists")

    # Copy the file
    import shutil
    shutil.copy2(str(source_path), str(target_path))

    new_relative_path = str(target_path.relative_to(files_dir)).replace("\\", "/")
    logger.info(f"Duplicated file from {filepath} to {new_relative_path}")

    return {
        "success": True,
        "message": "File duplicated successfully",
        "new_path": new_relative_path
    }


@app.delete("/api/workspace/files/{filepath:path}")
async def delete_workspace_file(filepath: str, ):
    """Delete a file or folder from the workspace. Supports folder paths (e.g., folder/file.csv)."""
    files_dir = get_workspace_files_dir()
    target_path = files_dir / filepath

    if not target_path.exists():
        raise HTTPException(status_code=404, detail="File or folder not found")

    # Security check: ensure path is within workspace
    try:
        target_path.resolve().relative_to(files_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")

    if target_path.is_dir():
        # Delete folder and all contents
        import shutil
        shutil.rmtree(target_path)
        logger.info(f"Deleted folder: {filepath}")
        return {"success": True, "message": f"Folder '{filepath}' deleted"}
    else:
        # Delete file
        target_path.unlink()
        logger.info(f"Deleted file: {filepath}")
        return {"success": True, "message": f"File '{filepath}' deleted"}


# ============================================================================
# Workspace - Library Management Endpoints
# ============================================================================

# Keep track of loaded custom libraries
loaded_custom_libraries: Dict[str, List[str]] = {}

# ============================================================================
# Project Management Endpoints
# ============================================================================

@app.get("/api/projects")
async def list_projects():
    """List all saved projects, organized by folders."""
    projects_dir = get_workspace_projects_dir()

    if not projects_dir.exists():
        return {"folders": [], "projects": []}

    folders = []
    root_projects = []

    # Scan directories and files
    for item in sorted(projects_dir.iterdir()):
        if item.name.startswith("."):
            continue  # Skip hidden files

        # Skip __pycache__ directories
        if item.is_dir() and item.name == "__pycache__":
            continue

        if item.is_dir():
            # It's a folder - get its projects
            folder_projects = []
            for file_path in sorted(item.iterdir()):
                # Skip __pycache__ directories inside folders
                if file_path.is_dir() and file_path.name == "__pycache__":
                    continue
                if file_path.is_file() and file_path.suffix == ".json":
                    try:
                        # Read project metadata
                        with open(file_path, "r", encoding="utf-8") as f:
                            data = json.load(f)

                        folder_projects.append({
                            "name": file_path.stem,
                            "filename": file_path.name,
                            "id": data.get("id", ""),
                            "imported_libraries": data.get("imported_libraries", []),
                            "modified_time": os.path.getmtime(file_path),
                            "folder": item.name,
                            "path": f"{item.name}/{file_path.name}"
                        })
                    except Exception as e:
                        logger.warning(f"Error reading project {file_path.name}: {e}")
                        continue

            folders.append({
                "name": item.name,
                "path": str(item),
                "projects": folder_projects,
            })
        elif item.is_file() and item.suffix == ".json":
            # Root level project file
            try:
                # Read project metadata
                with open(item, "r", encoding="utf-8") as f:
                    data = json.load(f)

                root_projects.append({
                    "name": item.stem,
                    "filename": item.name,
                    "id": data.get("id", ""),
                    "imported_libraries": data.get("imported_libraries", []),
                    "modified_time": os.path.getmtime(item),
                    "folder": "",
                    "path": item.name
                })
            except Exception as e:
                logger.warning(f"Error reading project {item.name}: {e}")
            continue

    # Sort by modified time (newest first)
    root_projects.sort(key=lambda x: x["modified_time"], reverse=True)
    for folder in folders:
        folder["projects"].sort(key=lambda x: x["modified_time"], reverse=True)

    return {
        "folders": folders,
        "projects": root_projects,  # Projects at root level
    }


@app.post("/api/projects/folders")
async def create_projects_folder(request: CreateFolderRequest, ):
    """Create a new folder in the workspace projects directory."""
    projects_dir = get_workspace_projects_dir()

    # Validate folder name
    folder_name = request.name.strip()
    if not folder_name or "/" in folder_name or "\\" in folder_name:
        raise HTTPException(status_code=400, detail="Invalid folder name")

    folder_path = projects_dir / folder_name

    if folder_path.exists():
        raise HTTPException(status_code=400, detail="Folder already exists")

    folder_path.mkdir(exist_ok=True)

    return {"success": True, "message": f"Created folder '{folder_name}'", "name": folder_name}


@app.post("/api/projects/save")
async def save_project(request: SaveProjectRequest, ):
    """
    Save the current workflow as a project.
    
    Request body should contain:
    - project_name: str (required) - name of the project (without .json extension)
    - overwrite: bool (optional) - whether to overwrite if project exists
    """
    scene_controller = get_local_scene_controller()

    if not scene_controller.model:
        raise HTTPException(status_code=400, detail="Scene not initialized")

    # Parse project name - support folder paths (e.g., "folder/project" or just "project")
    project_name = request.project_name.replace(".json", "").strip()
    if not project_name:
        raise HTTPException(status_code=400, detail="Invalid project name")

    # Remove invalid filename characters
    import re
    project_name = re.sub(r'[<>:"|?*]', '_', project_name)

    # Handle folder path (e.g., "folder/project")
    if "/" in project_name or "\\" in project_name:
        # Normalize path separators
        parts = project_name.replace("\\", "/").split("/")
        folder_parts = parts[:-1]
        project_name_only = parts[-1]

        projects_dir = get_workspace_projects_dir()
        # Create folder structure if needed
        if folder_parts:
            folder_path = projects_dir
            for folder_part in folder_parts:
                folder_path = folder_path / folder_part
                folder_path.mkdir(exist_ok=True)
            save_path = folder_path / f"{project_name_only}.json"
        else:
            save_path = projects_dir / f"{project_name_only}.json"
    else:
        projects_dir = get_workspace_projects_dir()
        save_path = projects_dir / f"{project_name}.json"

    # Check if file exists (unless overwrite is True)
    overwrite = request.overwrite
    if save_path.exists() and not overwrite:
        raise HTTPException(
            status_code=409,
            detail=f"Project '{project_name}' already exists. Set overwrite=true to overwrite."
        )

    try:
        # Collect all enabled libraries from the workspace (not just ones used by nodes)
        # This ensures that when loading a project, all libraries that were enabled
        # at save time will be enabled again
        imported_libraries = []
        libs_dir = get_workspace_libraries_dir()
        library_config = load_library_config()

        def collect_enabled_libraries(directory: Path, base_dir: Path = libs_dir):
            """Recursively collect all enabled library files."""
            if not directory.exists():
                return

            for item in sorted(directory.iterdir()):
                if item.name.startswith("."):
                    continue

                if item.is_dir() and not item.name.startswith("_"):
                    # Recurse into subdirectories
                    collect_enabled_libraries(item, base_dir)
                elif item.is_file() and item.suffix == ".py" and not item.name.startswith("_"):
                    # Get relative path for config lookup
                    try:
                        rel_path = item.relative_to(base_dir)
                        library_path = str(rel_path).replace("\\", "/")

                        # Check if library is enabled (default is True if not in config)
                        if is_library_enabled(library_path, library_config):
                            imported_libraries.append(library_path)
                    except ValueError:
                        # If file is not in base_dir, skip it
                        continue

        # Collect all enabled libraries from workspace
        collect_enabled_libraries(libs_dir, libs_dir)
        imported_libraries = sorted(list(set(imported_libraries)))  # Remove duplicates and sort

        # Update imported_libraries in the model before serializing
        scene_controller.model.imported_libraries = imported_libraries

        # Serialize and save the full scene (graph + annotations)
        scene_data = scene_controller.model.serialize()

        # Save to file
        with open(save_path, "w", encoding="utf-8") as f:
            json.dump(scene_data, f, indent=2)

        # Update model filepath and mark as not modified
        scene_controller.model.filepath = str(save_path)
        scene_controller.set_modified(False)

        logger.info(f"Project '{project_name}' saved to {save_path} with {len(imported_libraries)} imported libraries")

        return {
            "success": True,
            "message": f"Project '{project_name}' saved successfully",
            "filename": save_path.name,
            "path": str(save_path),
        }
    except Exception as e:
        logger.error(f"Error saving project: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save project: {str(e)}")


@app.get("/api/scene/is-modified")
async def check_scene_modified():
    """Check if the current scene has unsaved changes."""
    scene_controller = get_local_scene_controller()

    return {
        "is_modified": scene_controller.is_modified(),
        "has_filepath": bool(scene_controller.model.filepath)
    }


@app.post("/api/projects/load")
async def load_project(request: LoadProjectRequest, force: bool = Query(False, description="Force load even if there are unsaved changes"), ):
    """
    Load a project from the projects directory.
    
    If the current scene has unsaved changes and force=False, returns an error
    indicating unsaved changes. The frontend should show a confirmation dialog.
    """
    logger.info(f"=== LOAD PROJECT START: {request.project_name}, force={force} ===")

    try:
        scene_controller = get_local_scene_controller()

        logger.info("Scene controller is initialized")

        # Check for unsaved changes
        is_modified = scene_controller.is_modified()
        logger.info(f"Scene is_modified: {is_modified}, force: {force}")
        if not force and is_modified:
            logger.info("Unsaved changes detected, raising 409 error")
            raise HTTPException(
                status_code=409,  # Conflict status code
                detail="Current project has unsaved changes. Save or discard changes before loading a new project."
            )

        # Remove .json extension if present and handle folder paths
        project_name = request.project_name.replace(".json", "").strip()
        logger.info(f"Project name after sanitization: {project_name}")

        projects_dir = get_workspace_projects_dir()
        logger.info(f"Projects directory: {projects_dir}")
        # Handle folder paths (e.g., "folder/project" or just "project")
        if "/" in project_name or "\\" in project_name:
            # Normalize path separators
            parts = project_name.replace("\\", "/").split("/")
            project_name_only = parts[-1]
            folder_parts = parts[:-1]
            if folder_parts:
                project_path = projects_dir
                for folder_part in folder_parts:
                    project_path = project_path / folder_part
                project_path = project_path / f"{project_name_only}.json"
            else:
                project_path = projects_dir / f"{project_name_only}.json"
        else:
            project_path = projects_dir / f"{project_name}.json"
        logger.info(f"Project path: {project_path}")

        if not project_path.exists():
            logger.error(f"Project file not found: {project_path}")
            raise HTTPException(status_code=404, detail=f"Project '{project_name}' not found")

        logger.info("Project file exists, starting to load...")

        try:
            # Read the JSON to get library paths BEFORE deserializing nodes
            logger.info("Reading project JSON file...")
            with open(project_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            logger.info(f"Project JSON loaded, found {len(data.get('imported_libraries', []))} imported libraries")

            # Auto-import libraries before loading the graph
            imported_libraries = data.get("imported_libraries", [])
            missing_libraries = []
            import_errors = []

            # First, ensure all imported libraries are enabled in the config
            library_config = load_library_config()
            libs_dir = get_workspace_libraries_dir()
            config_updated = False

            for lib_path in imported_libraries:
                # Libraries are in workspace/libraries/
                # The lib_path might be relative or absolute
                if os.path.isabs(lib_path):
                    # Absolute path - check if it exists
                    if not os.path.exists(lib_path):
                        missing_libraries.append(lib_path)
                        continue
                    file_path = Path(lib_path)
                else:
                    # Relative path - try to find in web libraries directory
                    file_path = libs_dir / lib_path
                    if not file_path.exists():
                        missing_libraries.append(lib_path)
                        continue

                # Ensure this library is enabled in the config
                try:
                    rel_path = file_path.relative_to(libs_dir)
                    config_path = str(rel_path).replace("\\", "/")

                    # Enable the library if it's not already enabled
                    if not is_library_enabled(config_path, library_config):
                        # The config structure is: {"path": True/False}
                        library_config[config_path] = True
                        config_updated = True
                        logger.info(f"Enabling library for project load: {config_path}")
                except ValueError:
                    # If we can't get relative path, skip
                    logger.warning(f"Could not resolve relative path for library: {lib_path}")
                    continue

            # Save config if we updated it
            if config_updated:
                # The config structure for save_library_config expects {"enabled_libraries": {...}}
                # But load_library_config returns just the dict, so we need to wrap it
                save_library_config(library_config)

            # Now reload all libraries (this will load all enabled libraries, including the ones we just enabled)
            # We'll reload libraries directly using LibraryLoader instead of calling reload_custom_libraries
            # to avoid forward reference issues
            logger.info("Starting library reload process...")
            try:
                logger.info("Importing LibraryLoader...")
                from sciplex_core.utils.library_loader import LibraryLoader
                logger.info("LibraryLoader imported successfully")

                logger.info(f"Creating LibraryLoader with base_dir: {base_dir}")
                library_loader = LibraryLoader(base_dir)
                logger.info("LibraryLoader created successfully")

                logger.info("Getting workspace libraries directory...")
                libs_dir = get_workspace_libraries_dir()
                logger.info(f"Libraries directory: {libs_dir}")

                logger.info("Loading library config...")
                library_config = load_library_config()
                logger.info(f"Library config loaded: {len(library_config)} entries")

                # Clear existing custom libraries from library_model
                logger.info("Clearing existing custom libraries...")
                # Get list of custom library names to remove
                custom_lib_names = set()
                all_nodes = library_model.get_library_items().keys()
                logger.info(f"Found {len(all_nodes)} existing nodes in library model")

                for node_name in all_nodes:
                    library_item = library_model.get_library_item(node_name)
                    if library_item and library_item.library_name not in ['default', 'Display']:
                        custom_lib_names.add(library_item.library_name)

                logger.info(f"Found {len(custom_lib_names)} custom libraries to remove: {custom_lib_names}")

                # Remove custom libraries
                for lib_name in custom_lib_names:
                    logger.info(f"Removing library: {lib_name}")
                    library_model.remove_library(lib_name)

                logger.info("Custom libraries cleared")

                # Reload all enabled libraries
                libraries_loaded_count = [0]  # Use list to allow modification in nested function

                def load_from_dir(directory: Path, base_dir: Path = libs_dir):
                    """Load all .py files from a directory."""
                    logger.info(f"Loading from directory: {directory}")
                    if not directory.exists():
                        logger.warning(f"Directory does not exist: {directory}")
                        return

                    items = sorted(directory.iterdir())
                    logger.info(f"Found {len(items)} items in {directory}")

                    for item in items:
                        if item.is_dir() and not item.name.startswith("_"):
                            logger.info(f"Recursing into subdirectory: {item.name}")
                            load_from_dir(item, base_dir)
                        elif item.is_file() and item.suffix == ".py" and not item.name.startswith("_"):
                            logger.info(f"Processing library file: {item.name}")
                            try:
                                rel_path = item.relative_to(base_dir)
                                library_path = str(rel_path).replace("\\", "/")
                                logger.info(f"Library path: {library_path}")

                                is_enabled = is_library_enabled(library_path, library_config)
                                logger.info(f"Library {library_path} enabled: {is_enabled}")

                                if not is_enabled:
                                    logger.info(f"Skipping disabled library: {library_path}")
                                    continue

                                logger.info(f"Loading library file: {item}")
                                result = library_loader.load_library_file(str(item))
                                logger.info(f"Load result for {item.name}: {result}")

                                if result and result.get("success"):
                                    libraries_loaded_count[0] += 1
                                    logger.info(f"Successfully loaded library: {item.name}")
                                else:
                                    logger.warning(f"Failed to load library {item.name}: {result.get('message', 'Unknown error') if result else 'No result'}")
                            except Exception as e:
                                logger.error(f"Error loading library {item.name}: {e}", exc_info=True)

                logger.info("Starting to load libraries from directory...")
                load_from_dir(libs_dir, libs_dir)
                logger.info(f"Library reload complete. Loaded {libraries_loaded_count[0]} libraries.")

            except Exception as e:
                error_msg = f"Failed to reload libraries: {str(e)}"
                logger.error(error_msg, exc_info=True)
                logger.error(f"Exception type: {type(e).__name__}")
                logger.error(f"Exception args: {e.args}")
                import_errors.append(error_msg)

            # Now load the project
            logger.info("=== LOADING PROJECT FILE ===")
            logger.info(f"Calling scene_controller.model.load_from_file({project_path})")
            try:
                scene_controller.model.load_from_file(str(project_path))
                logger.info("Project file loaded successfully into model")
            except Exception as e:
                logger.error(f"Error in load_from_file: {e}", exc_info=True)
                raise

            # IMPORTANT: Reset execution state for all nodes when loading a project.
            # Execution flags (executed/failed) are runtime/session state and should
            # not be restored from project files. This keeps future undo/history
            # based on serialization meaningful, while ensuring a freshly loaded
            # project starts in a "not executed" state.
            try:
                if scene_controller.model.graph and getattr(scene_controller.model.graph, "nodes", None):
                    for node in scene_controller.model.graph.nodes:
                        if hasattr(node, "executed"):
                            node.executed = False
                        if hasattr(node, "failed"):
                            node.failed = False
                    logger.info("Reset executed/failed flags for all nodes after project load")
            except Exception as e:
                logger.warning(f"Failed to reset executed/failed flags after project load: {e}", exc_info=True)

            logger.info("Updating graph controller reference...")
            try:
                scene_controller._update_graph_controller_ref()
                logger.info("Graph controller reference updated")
            except Exception as e:
                logger.error(f"Error updating graph controller reference: {e}", exc_info=True)
                raise

            # Mark as not modified after loading
            logger.info("Marking scene as not modified...")
            try:
                scene_controller.set_modified(False)
                logger.info("Scene marked as not modified")
            except Exception as e:
                logger.error(f"Error setting modified flag: {e}", exc_info=True)
                raise

            # Emit WebSocket event for graph update
            logger.info("Checking if graph exists for WebSocket event...")
            if scene_controller.model.graph is None:
                logger.error("Graph is None after loading project! This should not happen.")
                raise HTTPException(
                    status_code=500,
                    detail="Failed to load project: graph deserialization failed. Check server logs for details."
                )

            logger.info(f"Graph loaded successfully. Nodes: {len(scene_controller.model.graph.nodes)}, Edges: {len(scene_controller.model.graph.edges)}")

            # Transform nodes and edges for frontend
            logger.info("Transforming nodes and edges for frontend...")
            try:
                graph_data = {
                    "nodes": [transform_node_for_frontend(n) for n in scene_controller.model.graph.nodes],
                    "edges": [
                        {
                            "id": e.id,
                            "start_socket_id": e.start_socket.id,
                            "end_socket_id": e.end_socket.id,
                            "start_node_id": e.start_node.id,
                            "end_node_id": e.end_node.id,
                        }
                        for e in scene_controller.model.graph.edges
                    ],
                    "annotations": [
                        {
                            "id": a.id,
                            "text": a.text,
                            "pos_x": a.pos_x,
                            "pos_y": a.pos_y,
                            "width": a.width,
                            "height": a.height,
                            "is_selected": a.is_selected,
                        }
                        for a in scene_controller.model.scene_annotations
                    ],
                }
                logger.info(f"Transformed {len(graph_data['nodes'])} nodes and {len(graph_data['edges'])} edges")
            except Exception as e:
                logger.exception(f"Error transforming graph data for frontend: {e}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to transform graph data: {str(e)}"
                )

            logger.info("Preparing to emit WebSocket event...")
            logger.info(f"ws_emitter type: {type(ws_emitter)}")
            logger.info(f"ws_emitter.emit type: {type(ws_emitter.emit)}")
            logger.info(f"ws_emitter.emit callable: {callable(ws_emitter.emit)}")

            try:
                emit_result = ws_emitter.emit("graph_state", graph_data)
                logger.info(f"emit() returned: {emit_result}, type: {type(emit_result)}")

                if emit_result is None:
                    logger.warning("ws_emitter.emit() returned None - this might be the issue!")
                else:
                    logger.info("Awaiting emit result...")
                    await emit_result
                    logger.info("WebSocket event emitted successfully")
            except Exception as e:
                logger.error(f"Error emitting WebSocket event: {e}", exc_info=True)
                logger.error(f"Exception type: {type(e).__name__}")
                raise

            warnings = []
            if missing_libraries:
                warnings.append(f"Missing libraries: {', '.join(missing_libraries)}")
            if import_errors:
                warnings.append(f"Library import errors: {', '.join(import_errors)}")

            logger.info(f"Project '{project_name}' loaded from {project_path}")

            return {
                "success": True,
                "message": f"Project '{project_name}' loaded successfully",
                "project_name": project_name,  # Include project name in response
                "warnings": warnings if warnings else None,
            }
        except Exception as e:
            logger.error(f"Error in project loading block: {e}", exc_info=True)
            raise
    except HTTPException:
        # Re-raise HTTPException as-is (e.g., 409 for unsaved changes)
        raise
    except Exception as e:
        logger.error(f"Error loading project: {e}", exc_info=True)
        logger.error(f"Exception type: {type(e).__name__}")
        logger.error(f"Exception args: {e.args}")
        logger.error(f"Exception traceback: {type(e).__traceback__}")
        raise HTTPException(status_code=500, detail=f"Failed to load project: {str(e)}")


@app.delete("/api/projects/{project_path:path}")
async def delete_project(project_path: str):
    """Delete a project from the projects directory. Supports folder paths (e.g., folder/project)."""
    # Remove .json extension if present and handle folder paths
    project_name = project_path.replace(".json", "").strip()

    projects_dir = get_workspace_projects_dir()
    # Handle folder paths
    if "/" in project_name or "\\" in project_name:
        # Normalize path separators
        parts = project_name.replace("\\", "/").split("/")
        project_name_only = parts[-1]
        folder_parts = parts[:-1]
        if folder_parts:
            project_path_obj = projects_dir
            for folder_part in folder_parts:
                project_path_obj = project_path_obj / folder_part
            project_path_obj = project_path_obj / f"{project_name_only}.json"
        else:
            project_path_obj = projects_dir / f"{project_name_only}.json"
    else:
        project_path_obj = projects_dir / f"{project_name}.json"

    if not project_path_obj.exists():
        raise HTTPException(status_code=404, detail=f"Project '{project_path}' not found")

    # Security check: ensure path is within projects directory
    try:
        project_path_obj.resolve().relative_to(projects_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Invalid project path")

    try:
        if project_path_obj.is_dir():
            # Delete folder and all contents
            import shutil
            shutil.rmtree(project_path_obj)
            logger.info(f"Project folder '{project_path}' deleted")
            return {"success": True, "message": f"Project folder '{project_path}' deleted successfully"}
        else:
            project_path_obj.unlink()
            logger.info(f"Project '{project_path}' deleted")
            return {"success": True, "message": f"Project '{project_path}' deleted successfully"}
    except Exception as e:
        logger.error(f"Error deleting project: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete project: {str(e)}")


@app.post("/api/projects/{project_path:path}/move")
async def move_project(project_path: str, request: MoveFileRequest):
    """Move a project to a different folder."""
    projects_dir = get_workspace_projects_dir()

    # Parse project path
    project_name = project_path.replace(".json", "").strip()
    if "/" in project_name or "\\" in project_name:
        parts = project_name.replace("\\", "/").split("/")
        project_name_only = parts[-1]
        folder_parts = parts[:-1]
        if folder_parts:
            source_path = projects_dir
            for folder_part in folder_parts:
                source_path = source_path / folder_part
            source_path = source_path / f"{project_name_only}.json"
        else:
            source_path = projects_dir / f"{project_name_only}.json"
    else:
        source_path = projects_dir / f"{project_name}.json"

    if not source_path.exists():
        raise HTTPException(status_code=404, detail="Project not found")

    if not source_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a project file")

    # Security check
    try:
        source_path.resolve().relative_to(projects_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Invalid project path")

    # Determine target directory
    if request.target_folder:
        target_dir = projects_dir / request.target_folder
        if not target_dir.exists() or not target_dir.is_dir():
            raise HTTPException(status_code=404, detail="Target folder not found")
        target_path = target_dir / source_path.name
    else:
        # Move to root
        target_path = projects_dir / source_path.name

    # Check if target already exists
    if target_path.exists():
        raise HTTPException(status_code=409, detail="Project already exists in target location")

    # Security check: ensure target is within workspace
    try:
        target_path.resolve().relative_to(projects_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Invalid target path")

    # Move the file
    import shutil
    shutil.move(str(source_path), str(target_path))

    new_relative_path = str(target_path.relative_to(projects_dir)).replace("\\", "/")
    logger.info(f"Moved project from {project_path} to {new_relative_path}")

    return {
        "success": True,
        "message": "Project moved successfully",
        "new_path": new_relative_path
    }


@app.post("/api/projects/{project_path:path}/duplicate")
async def duplicate_project(project_path: str, request: DuplicateRequest = DuplicateRequest()):
    """Duplicate a project file."""
    projects_dir = get_workspace_projects_dir()

    # Parse project path
    project_name = project_path.replace(".json", "").strip()
    if "/" in project_name or "\\" in project_name:
        parts = project_name.replace("\\", "/").split("/")
        project_name_only = parts[-1]
        folder_parts = parts[:-1]
        if folder_parts:
            source_path = projects_dir
            for folder_part in folder_parts:
                source_path = source_path / folder_part
            source_path = source_path / f"{project_name_only}.json"
        else:
            source_path = projects_dir / f"{project_name_only}.json"
    else:
        source_path = projects_dir / f"{project_name}.json"

    if not source_path.exists():
        raise HTTPException(status_code=404, detail="Project not found")

    if not source_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a project file")

    # Security check
    try:
        source_path.resolve().relative_to(projects_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Invalid project path")

    # Generate new name if not provided
    if request.new_name:
        new_name = request.new_name.strip()
        if not new_name.endswith('.json'):
            new_name += '.json'
        if "/" in new_name or "\\" in new_name:
            raise HTTPException(status_code=400, detail="Invalid project name")
    else:
        # Auto-generate name
        stem = source_path.stem
        base_name = f"{stem}_copy.json"
        counter = 1
        while (source_path.parent / base_name).exists():
            base_name = f"{stem} ({counter}).json"
            counter += 1
        new_name = base_name

    # Determine target path (same directory)
    target_path = source_path.parent / new_name

    if target_path.exists():
        raise HTTPException(status_code=409, detail="Project with this name already exists")

    # Copy the file
    import shutil
    shutil.copy2(str(source_path), str(target_path))

    new_relative_path = str(target_path.relative_to(projects_dir)).replace("\\", "/")
    logger.info(f"Duplicated project from {project_path} to {new_relative_path}")

    return {
        "success": True,
        "message": "Project duplicated successfully",
        "new_path": new_relative_path
    }


@app.post("/api/projects/{project_path:path}/rename")
async def rename_project(project_path: str, request: RenameRequest):
    """Rename a project file."""
    projects_dir = get_workspace_projects_dir()

    # Parse project path
    project_name = project_path.replace(".json", "").strip()
    if "/" in project_name or "\\" in project_name:
        parts = project_name.replace("\\", "/").split("/")
        project_name_only = parts[-1]
        folder_parts = parts[:-1]
        if folder_parts:
            source_path = projects_dir
            for folder_part in folder_parts:
                source_path = source_path / folder_part
            source_path = source_path / f"{project_name_only}.json"
        else:
            source_path = projects_dir / f"{project_name_only}.json"
    else:
        source_path = projects_dir / f"{project_name}.json"

    if not source_path.exists():
        raise HTTPException(status_code=404, detail="Project not found")

    if not source_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a project file")

    # Security check
    try:
        source_path.resolve().relative_to(projects_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Invalid project path")

    # Validate new name
    new_name = request.new_name.strip()
    if not new_name.endswith('.json'):
        new_name += '.json'
    if "/" in new_name or "\\" in new_name:
        raise HTTPException(status_code=400, detail="Invalid project name")

    # Determine target path (same directory, new name)
    target_path = source_path.parent / new_name

    if target_path.exists():
        raise HTTPException(status_code=409, detail="Project with this name already exists")

    # Rename
    source_path.rename(target_path)

    new_relative_path = str(target_path.relative_to(projects_dir)).replace("\\", "/")
    logger.info(f"Renamed project from {project_path} to {new_relative_path}")

    return {
        "success": True,
        "message": "Project renamed successfully",
        "new_path": new_relative_path
    }


@app.get("/api/projects/{project_path:path}/download")
async def download_project(project_path: str):
    """Download a project file. Supports folder paths (e.g., folder/project)."""
    projects_dir = get_workspace_projects_dir()

    # Remove .json extension if present and handle folder paths
    project_name = project_path.replace(".json", "").strip()

    # Handle folder paths
    if "/" in project_name or "\\" in project_name:
        # Normalize path separators
        parts = project_name.replace("\\", "/").split("/")
        project_name_only = parts[-1]
        folder_parts = parts[:-1]
        if folder_parts:
            project_path_obj = projects_dir
            for folder_part in folder_parts:
                project_path_obj = project_path_obj / folder_part
            project_path_obj = project_path_obj / f"{project_name_only}.json"
        else:
            project_path_obj = projects_dir / f"{project_name_only}.json"
    else:
        project_path_obj = projects_dir / f"{project_name}.json"

    if not project_path_obj.exists():
        raise HTTPException(status_code=404, detail="Project not found")

    if not project_path_obj.is_file():
        raise HTTPException(status_code=400, detail="Path is not a project file")

    # Security check: ensure path is within projects directory
    try:
        project_path_obj.resolve().relative_to(projects_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Invalid project path")

    project_name_for_download = project_name_only if 'project_name_only' in locals() else project_name
    return FileResponse(
        path=str(project_path_obj),
        filename=f"{project_name_for_download}.json",
        media_type="application/json"
    )


def get_library_info(file_path: Path, folder: str = "") -> dict:
    """Get library info for a single file (including helper files and README)."""
    lib_name = file_path.stem
    is_helper = file_path.name.startswith("_")

    # Helper files don't have nodes, but regular libraries do
    if is_helper or file_path.suffix.lower() != ".py":
        lib_nodes = []
        loaded = False
    else:
        lib_nodes = library_model.get_library_item_names_by_library(lib_name)
        loaded = len(lib_nodes) > 0

    # Determine path relative to libraries directory for config lookup
    libs_dir = get_workspace_libraries_dir()
    try:
        rel_path = file_path.relative_to(libs_dir)
        library_path = str(rel_path).replace("\\", "/")
    except ValueError:
        # If file is not in libraries dir, use filename
        library_path = f"{folder}/{file_path.name}" if folder else file_path.name

    # Get enabled state when this is a Python file
    enabled = None
    if file_path.suffix.lower() == ".py" and not is_helper:
        library_config = load_library_config()
        enabled = is_library_enabled(library_path, library_config)

    stat = file_path.stat()

    return {
        "name": lib_name,
        "filename": file_path.name,
        "folder": folder,
        "path": library_path,
        "full_path": str(file_path),
        "nodes": lib_nodes,
        "loaded": loaded,
        "is_helper": is_helper,  # Mark as helper file
        "enabled": enabled,  # None for helpers, True/False for regular libraries
        "size": stat.st_size,
        "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
    }


@app.get("/api/workspace/libraries")
async def list_workspace_libraries():
    """List all libraries organized by folders.
    
    Returns a structure with folders and their library files.
    """
    libs_dir = get_workspace_libraries_dir()

    if not libs_dir.exists():
        return {"folders": [], "libraries": []}

    folders = []
    root_libraries = []

    # Scan directories and files
    for item in sorted(libs_dir.iterdir()):
        if item.name.startswith("."):
            continue  # Skip hidden files like .git, but include _helpers.py

        # Skip __pycache__ directories
        if item.is_dir() and item.name == "__pycache__":
            continue

        if item.is_dir():
            # It's a folder - get its libraries (including helper files)
            folder_libraries = []
            for file_path in sorted(item.iterdir()):
                # Skip __pycache__ directories inside folders too
                if file_path.is_dir() and file_path.name == "__pycache__":
                    continue
                if file_path.is_file() and (file_path.suffix.lower() == ".py" or file_path.name.lower() == "readme.md"):
                    folder_libraries.append(get_library_info(file_path, item.name))

            folders.append({
                "name": item.name,
                "path": str(item),
                "libraries": folder_libraries,
                "is_default": item.name == "default",
            })
        elif item.is_file() and (item.suffix.lower() == ".py" or item.name.lower() == "readme.md"):
            root_libraries.append(get_library_info(item, ""))

    return {
        "folders": folders,
        "libraries": root_libraries,  # Libraries at root level
    }


@app.post("/api/workspace/libraries/folders")
async def create_library_folder(request: CreateFolderRequest, ):
    """Create a new library folder."""
    libs_dir = get_workspace_libraries_dir()

    # Validate folder name
    folder_name = request.name.strip()
    if not folder_name or "/" in folder_name or "\\" in folder_name:
        raise HTTPException(status_code=400, detail="Invalid folder name")

    folder_path = libs_dir / folder_name

    if folder_path.exists():
        raise HTTPException(status_code=400, detail="Folder already exists")

    folder_path.mkdir(exist_ok=True)

    return {"success": True, "message": f"Created folder '{folder_name}'", "name": folder_name}


class CreateLibraryRequest(BaseModel):
    name: str
    folder: str = ""  # Empty string for root level
    content: str = ""


@app.post("/api/workspace/libraries/files")
async def create_library_file(request: CreateLibraryRequest, ):
    """Create a new library file."""
    libs_dir = get_workspace_libraries_dir()

    # Validate library name
    lib_name = request.name.strip()
    if not lib_name:
        raise HTTPException(status_code=400, detail="Library name is required")

    # Ensure .py extension
    if not lib_name.endswith(".py"):
        lib_name = f"{lib_name}.py"

    # Determine target path
    if request.folder:
        target_dir = libs_dir / request.folder
        if not target_dir.exists():
            raise HTTPException(status_code=404, detail=f"Folder '{request.folder}' not found")
    else:
        target_dir = libs_dir

    file_path = target_dir / lib_name

    if file_path.exists():
        raise HTTPException(status_code=400, detail="Library file already exists")

    # Default content for new library
    default_content = request.content or '''"""
Custom library file.

Use @nodify decorator to create nodes from functions.

If you don't use nodify, then arguemnts with default values will be treated as parameters, others as inputs.
"""

from sciplex import nodify, Attribute

@nodify(icon="python")
def MyCustomNode(input_data, factor: int = 10):
    """
    Example custom node.
    
    Args:
        input_data: Input data to process
        factor: Multiplication factor
    
    Returns:
        Processed data
    """
    return input_data * factor
'''

    # Write file
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(default_content)

    return {
        "success": True,
        "message": f"Created library '{lib_name}'",
        "library": get_library_info(file_path, request.folder),
    }


def resolve_library_path(library_path: str) -> Path:
    """Resolve a library path (folder/filename or just filename) to full path."""
    libs_dir = get_workspace_libraries_dir()

    # Handle path like "default/machine_learning" or just "mylib"
    if "/" in library_path:
        parts = library_path.split("/", 1)
        folder = parts[0]
        name = parts[1]
    else:
        folder = ""
        name = library_path

    # Ensure .py extension
    if not name.lower().endswith(".md") and not name.endswith(".py"):
        name = f"{name}.py"

    if folder:
        file_path = libs_dir / folder / name
    else:
        file_path = libs_dir / name

    return file_path


@app.get("/api/workspace/libraries/{library_path:path}/content")
async def get_library_content(library_path: str, ):
    """Get the content of a library file. Path can be 'folder/name' or just 'name'."""
    file_path = resolve_library_path(library_path)

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Library not found")

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
        return {
            "name": file_path.stem,
            "filename": file_path.name,
            "path": library_path,
            "content": content,
            "size": file_path.stat().st_size,
        }
    except Exception as e:
        logger.error(f"Error reading library file {library_path}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to read library file: {e}")


@app.get("/api/workspace/libraries/{library_path:path}/download")
async def download_library(library_path: str, ):
    """Download a library file. Path can be 'folder/name' or just 'name'."""
    file_path = resolve_library_path(library_path)

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Library not found")

    return FileResponse(
        path=str(file_path),
        filename=file_path.name,
        media_type="text/x-python"
    )


class UpdateLibraryContentRequest(BaseModel):
    content: str


@app.put("/api/workspace/libraries/{library_path:path}/content")
async def update_library_content(library_path: str, request: UpdateLibraryContentRequest, ):
    """Update the content of a library file and reload it. Path can be 'folder/name' or just 'name'."""
    file_path = resolve_library_path(library_path)
    library_name = file_path.stem
    is_helper = file_path.name.startswith("_")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Library not found")

    try:
        # Save the new content
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(request.content)

        if is_helper:
            # Helper files don't have nodes, but other libraries might import from them
            # Reload all libraries to pick up changes in the helper
            logger.info(f"Helper file {library_name} updated, reloading all libraries...")
            await reload_custom_libraries()

            return {
                "success": True,
                "message": f"Helper file '{library_name}' saved. All libraries reloaded.",
                "nodes": []
            }
        else:
            # Regular library file - unregister old nodes and reload
            library_model.remove_library(library_name)

            # Reload the library
            library_loader = LibraryLoader(base_dir)
            result = library_loader.load_library_file(str(file_path))

            if not result.get("success"):
                logger.warning(f"Failed to reload library {library_name}: {result.get('message')}")
                return {
                    "success": False,
                    "message": result.get("message", "Failed to reload library"),
                    "nodes": []
                }

            # Get the new nodes from this library
            new_nodes = library_model.get_library_item_names_by_library(library_name)

            logger.info(f"Library {library_name} updated and reloaded with nodes: {new_nodes}")

            return {
                "success": True,
                "message": f"Library '{library_name}' saved and reloaded",
                "nodes": new_nodes
            }

    except SyntaxError as e:
        logger.error(f"Syntax error in library {library_name}: {e}")
        raise HTTPException(status_code=400, detail=f"Syntax error: {e}")
    except Exception as e:
        logger.error(f"Error updating library file {library_name}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save library file: {e}")


@app.post("/api/workspace/libraries/upload")
async def upload_library_files(files: List[UploadFile] = File(...), folder: str = Query("", description="Folder name to upload to (empty for root)")):
    """Upload Python library files and load them, optionally to a specific folder."""
    libs_dir = get_workspace_libraries_dir()
    uploaded = []

    # Determine target directory
    if folder:
        target_dir = libs_dir / folder
        target_dir.mkdir(parents=True, exist_ok=True)
    else:
        target_dir = libs_dir

    for file in files:
        filename = file.filename or ""
        if not filename:
            raise HTTPException(status_code=400, detail="Missing filename")
        # Validate extension
        if not filename.endswith(".py"):
            raise HTTPException(
                status_code=400,
                detail="Only Python files (.py) are allowed"
            )

        # Save file
        file_path = target_dir / filename

        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)

        uploaded.append(filename)

    # Reload libraries
    await reload_custom_libraries()

    return {
        "message": f"Uploaded {len(uploaded)} library file(s)",
        "files": uploaded
    }


@app.delete("/api/workspace/libraries/{library_path:path}")
async def delete_library(library_path: str, ):
    """Delete a library file. Path can be 'folder/name' or just 'name'."""
    file_path = resolve_library_path(library_path)
    library_name = file_path.stem

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Library not found")

    libs_dir = get_workspace_libraries_dir()
    try:
        rel_path = file_path.relative_to(libs_dir).as_posix()
    except ValueError:
        rel_path = library_path

    library_config = load_library_config()
    library_config[rel_path] = False
    save_library_config(library_config)

    # Unregister all nodes from this library using library_model's built-in method
    library_model.remove_library(library_name)

    # Remove from loaded_custom_libraries tracking
    if library_name in loaded_custom_libraries:
        del loaded_custom_libraries[library_name]

    file_path.unlink()
    return {"success": True, "message": f"Deleted library {library_name}"}


@app.post("/api/workspace/libraries/{library_path:path}/move")
async def move_library(library_path: str, request: MoveFileRequest):
    """Move a library to a different folder."""
    libs_dir = get_workspace_libraries_dir()
    source_path = resolve_library_path(library_path)

    if not source_path.exists():
        raise HTTPException(status_code=404, detail="Library not found")

    if not source_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a library file")

    # Security check
    try:
        source_path.resolve().relative_to(libs_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Invalid library path")

    # Determine target directory
    if request.target_folder:
        target_dir = libs_dir / request.target_folder
        if not target_dir.exists() or not target_dir.is_dir():
            raise HTTPException(status_code=404, detail="Target folder not found")
        target_path = target_dir / source_path.name
    else:
        # Move to root
        target_path = libs_dir / source_path.name

    # Check if target already exists
    if target_path.exists():
        raise HTTPException(status_code=409, detail="Library already exists in target location")

    # Security check: ensure target is within workspace
    try:
        target_path.resolve().relative_to(libs_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Invalid target path")

    # Move the file
    import shutil
    shutil.move(str(source_path), str(target_path))

    # Reload libraries after move
    await reload_custom_libraries()

    new_relative_path = str(target_path.relative_to(libs_dir)).replace("\\", "/")
    logger.info(f"Moved library from {library_path} to {new_relative_path}")

    return {
        "success": True,
        "message": "Library moved successfully",
        "new_path": new_relative_path
    }


@app.post("/api/workspace/libraries/{library_path:path}/duplicate")
async def duplicate_library(library_path: str, request: DuplicateRequest = DuplicateRequest()):
    """Duplicate a library file."""
    libs_dir = get_workspace_libraries_dir()
    source_path = resolve_library_path(library_path)

    if not source_path.exists():
        raise HTTPException(status_code=404, detail="Library not found")

    if not source_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a library file")

    # Security check
    try:
        source_path.resolve().relative_to(libs_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Invalid library path")

    # Generate new name if not provided
    if request.new_name:
        new_name = request.new_name.strip()
        if not new_name.endswith('.py'):
            new_name += '.py'
        if "/" in new_name or "\\" in new_name:
            raise HTTPException(status_code=400, detail="Invalid library name")
    else:
        # Auto-generate name
        stem = source_path.stem
        base_name = f"{stem}_copy.py"
        counter = 1
        while (source_path.parent / base_name).exists():
            base_name = f"{stem} ({counter}).py"
            counter += 1
        new_name = base_name

    # Determine target path (same directory)
    target_path = source_path.parent / new_name

    if target_path.exists():
        raise HTTPException(status_code=409, detail="Library with this name already exists")

    # Copy the file
    import shutil
    shutil.copy2(str(source_path), str(target_path))

    # Reload libraries after duplication
    await reload_custom_libraries()

    new_relative_path = str(target_path.relative_to(libs_dir)).replace("\\", "/")
    logger.info(f"Duplicated library from {library_path} to {new_relative_path}")

    return {
        "success": True,
        "message": "Library duplicated successfully",
        "new_path": new_relative_path
    }


@app.post("/api/workspace/libraries/{library_path:path}/rename")
async def rename_library(library_path: str, request: RenameRequest):
    """Rename a library file."""
    libs_dir = get_workspace_libraries_dir()
    source_path = resolve_library_path(library_path)

    if not source_path.exists():
        raise HTTPException(status_code=404, detail="Library not found")

    if not source_path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a library file")

    # Security check
    try:
        source_path.resolve().relative_to(libs_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Invalid library path")

    # Validate new name
    new_name = request.new_name.strip()
    if not new_name.endswith('.py'):
        new_name += '.py'
    if "/" in new_name or "\\" in new_name:
        raise HTTPException(status_code=400, detail="Invalid library name")

    # Determine target path (same directory, new name)
    target_path = source_path.parent / new_name

    if target_path.exists():
        raise HTTPException(status_code=409, detail="Library with this name already exists")

    # Get library name before rename for unregistering
    old_library_name = source_path.stem

    # Rename
    source_path.rename(target_path)

    # Unregister old library and reload
    library_model.remove_library(old_library_name)
    await reload_custom_libraries()

    new_relative_path = str(target_path.relative_to(libs_dir)).replace("\\", "/")
    logger.info(f"Renamed library from {library_path} to {new_relative_path}")

    return {
        "success": True,
        "message": "Library renamed successfully",
        "new_path": new_relative_path
    }


@app.post("/api/workspace/libraries/reload")
async def reload_libraries():
    """Reload all custom libraries."""
    await reload_custom_libraries()
    return {"success": True, "message": "Libraries reloaded"}


class ToggleLibraryEnabledRequest(BaseModel):
    enabled: bool


@app.post("/api/workspace/libraries/{library_path:path}/toggle-enabled")
async def toggle_library_enabled(library_path: str, request: ToggleLibraryEnabledRequest, ):
    """Toggle the enabled/disabled state of a library.
    
    When disabled, the library will not be loaded into the library model.
    Files starting with _ (helpers) cannot be toggled.
    """
    libs_dir = get_workspace_libraries_dir()

    # Resolve the library file path
    file_path = libs_dir / library_path.replace("/", os.sep)

    # Check if file exists
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Library not found")

    # Security check: ensure file is within libraries directory
    try:
        file_path.resolve().relative_to(libs_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Access denied")

    # Check if it's a helper file (cannot be toggled)
    if file_path.name.startswith("_"):
        raise HTTPException(status_code=400, detail="Helper files cannot be enabled/disabled")

    # Get relative path for config
    try:
        rel_path = file_path.relative_to(libs_dir)
        config_path = str(rel_path).replace("\\", "/")
    except ValueError:
        config_path = file_path.name

    # Load and update config
    library_config = load_library_config()
    library_config[config_path] = request.enabled
    save_library_config(library_config)

    # If disabling, unload the library from the model
    if not request.enabled:
        # Get library name from file
        lib_name = file_path.stem
        # Remove all nodes from this library
        nodes_removed = library_model.remove_library(lib_name)
        logger.info(f"Disabled library '{config_path}', removed {nodes_removed} nodes")
    else:
        # If enabling, check for duplicate function names before loading
        # Parse the file to find function names (without executing)
        import ast
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                source = f.read()
            tree = ast.parse(source)

            # Find all function definitions
            function_names = []
            for node in ast.walk(tree):
                if isinstance(node, ast.FunctionDef):
                    function_names.append(node.name)

            # Check for conflicts
            conflicts = []
            for func_name in function_names:
                if func_name.startswith("_"):
                    continue  # Skip private functions
                existing_item = library_model.get_library_item(func_name)
                if existing_item is not None:
                    conflicts.append(func_name)

            if conflicts:
                # Return error with conflict details
                conflict_list = ", ".join(conflicts)
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot enable library: function name(s) already exist: {conflict_list}. Please rename or disable the conflicting library first."
                )
        except SyntaxError as e:
            # If we can't parse the file, still try to load it (might have syntax errors that will be caught later)
            logger.warning(f"Could not parse library file for duplicate check: {e}")
        except Exception as e:
            if isinstance(e, HTTPException):
                raise
            logger.warning(f"Error checking for duplicates: {e}")

        # No conflicts - proceed with loading
        library_loader = LibraryLoader(base_dir)
        try:
            result = library_loader.load_library_file(str(file_path))
            if result.get("success"):
                logger.info(f"Enabled library '{config_path}', loaded successfully")
            else:
                logger.warning(f"Failed to load library '{config_path}': {result.get('message')}")
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to load library: {result.get('message', 'Unknown error')}"
                )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error loading library '{config_path}': {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Error loading library: {str(e)}"
            )

    # Trigger library reload event
    await reload_custom_libraries()

    return {
        "success": True,
        "message": f"Library {'enabled' if request.enabled else 'disabled'}",
        "enabled": request.enabled
    }


async def reload_custom_libraries():
    """Reload all Python libraries from the workspace libraries directory.
    
    This reloads libraries from workspace/libraries/ including all subfolders.
    """
    global loaded_custom_libraries

    loaded_custom_libraries = {}

    # Use LibraryLoader to reload libraries from web app folder
    library_loader = LibraryLoader(base_dir)

    # Get all nodes before reload
    nodes_before = set(library_model.get_library_items().keys())

    # Reload libraries from workspace's libraries folder (including subfolders)
    libs_dir = get_workspace_libraries_dir()

    # Load library configuration
    library_config = load_library_config()

    def load_from_dir(directory: Path, base_dir: Path = libs_dir):
        """Load all .py files from a directory."""
        if not directory.exists():
            return
        for item in sorted(directory.iterdir()):
            if item.is_dir() and not item.name.startswith("_"):
                # Recurse into subdirectories
                load_from_dir(item, base_dir)
            elif item.is_file() and item.suffix == ".py" and not item.name.startswith("_"):
                # Get relative path from base_dir for config lookup
                try:
                    rel_path = item.relative_to(base_dir)
                    library_path = str(rel_path).replace("\\", "/")  # Normalize path separators

                    # Check if library is enabled
                    if not is_library_enabled(library_path, library_config):
                        logger.info(f"Skipping disabled library: {library_path}")
                        continue

                    result = library_loader.load_library_file(str(item))
                    if result.get("success"):
                        logger.info(f"Reloaded library from web app: {item.name}")
                    else:
                        logger.warning(f"Failed to reload library {item.name}: {result.get('message')}")
                except Exception as e:
                    logger.error(f"Error reloading library {item.name}: {e}")

    # Load from the libraries directory
    load_from_dir(libs_dir, libs_dir)

    # Get all nodes after reload
    nodes_after = set(library_model.get_library_items().keys())
    new_nodes = list(nodes_after - nodes_before)

    # Track which libraries were loaded
    # Group new nodes by their library name (from library_model)
    for node_name in new_nodes:
        library_item = library_model.get_library_item(node_name)
        if library_item:
            lib_name = library_item.library_name
            if lib_name not in loaded_custom_libraries:
                loaded_custom_libraries[lib_name] = []
            if node_name not in loaded_custom_libraries[lib_name]:
                loaded_custom_libraries[lib_name].append(node_name)

    # Log loaded libraries
    for lib_name, lib_nodes in loaded_custom_libraries.items():
        if lib_nodes:
            logger.info(f"Reloaded library '{lib_name}' with nodes: {lib_nodes}")


# ============================================================================
# Variables Registry / Workspace Endpoints
# ============================================================================

def serialize_value(value: Any) -> Any:
    """Serialize a value for JSON response, handling numpy arrays, pandas objects, Plotly figures, etc."""
    # Handle None
    if value is None:
        return None

    # Handle Plotly figures - convert to dict (which handles enums properly)
    try:
        import plotly.graph_objects as go
        if isinstance(value, go.Figure):
            # Use to_dict() which properly converts enums to strings
            return value.to_dict()
    except ImportError:
        pass
    except Exception as e:
        logger.warning(f"Failed to serialize Plotly figure: {e}")
        # Fallback to string representation
        return str(value)

    # Handle numpy arrays first (before checking for list/tuple)
    if isinstance(value, np.ndarray):
        return value.tolist()

    # Handle pandas objects
    if isinstance(value, pd.DataFrame):
        return value.to_dict(orient='records')
    if isinstance(value, pd.Series):
        return value.to_dict()

    # Handle basic types
    if isinstance(value, (str, int, float, bool)):
        return value

    # Handle dictionaries (recursively)
    if isinstance(value, dict):
        return {k: serialize_value(v) for k, v in value.items()}

    # Handle lists and tuples (recursively)
    if isinstance(value, (list, tuple)):
        return [serialize_value(item) for item in value]

    # For other types (objects, classes, etc.), convert to string representation
    return str(value)


def serialize_socket_with_data(socket: SocketModel, include_data: bool = False) -> dict:
    """Serialize a socket, optionally including its computed data.
    
    Args:
        socket: The socket to serialize
        include_data: If True, include the socket's data. Default False to avoid serializing input data.
    """
    serialized = socket.serialize()
    # Only include socket data if explicitly requested (for output sockets only)
    if include_data and socket.data is not None:
        try:
            serialized["data"] = serialize_value(socket.data)
        except Exception as e:
            logger.warning(f"Failed to serialize socket data for socket {socket.id}: {e}")
            # Don't include data if serialization fails
            pass
    return serialized


def serialize_node_with_socket_data(node_model) -> dict:
    """Serialize a node for copying. Does NOT include input socket data.
    
    This function creates a read-only snapshot of the node for copying.
    Input socket data is NEVER serialized (as it should be recomputed).
    Only output socket data could be included, but we currently exclude all socket data
    to avoid serialization issues with complex objects like Plotly figures.
    """
    # Serialize the node (read-only operation)
    serialized = node_model.serialize()
    # Serialize sockets WITHOUT data - input data should never be serialized,
    # and output data is excluded to avoid issues with Plotly figures, large datasets, etc.
    serialized["input_sockets"] = [serialize_socket_with_data(s, include_data=False) for s in node_model.input_sockets]
    serialized["output_sockets"] = [serialize_socket_with_data(s, include_data=False) for s in node_model.output_sockets]
    # Return a copy to ensure we don't accidentally mutate anything
    import copy
    return copy.deepcopy(serialized)


@app.post("/api/graph/copy")
async def copy_selection(request: Dict[str, Any], ):
    """Copy selected nodes and edges to clipboard (serialize to JSON)."""
    scene_controller = get_local_scene_controller()

    if not scene_controller.model.graph:
        raise HTTPException(status_code=404, detail="Graph not found")

    try:
        node_ids = request.get("node_ids", [])
        if not node_ids:
            return {"success": True, "data": json.dumps({"graph": {"nodes": [], "edges": []}})}

        # Collect selected nodes
        selected_nodes = []
        selected_node_ids = set(node_ids)

        for node in scene_controller.model.graph.nodes:
            if node.id in selected_node_ids:
                selected_nodes.append(node)

        logger.info(f"[COPY] Copying {len(selected_nodes)} node(s):")
        for node in selected_nodes:
            logger.info(f"  - Node ID: {node.id}, Title: {node.title}")
            # Also log parameter values to track them
            params = {name: attr.value for name, attr in node.parameters.items()}
            logger.info(f"    Parameters: {params}")

        # Collect edges whose endpoints are both in selected nodes
        selected_edges = []
        for edge in scene_controller.model.graph.edges:
            if (edge.start_node.id in selected_node_ids and
                edge.end_node.id in selected_node_ids):
                selected_edges.append(edge)

        logger.info(f"[COPY] Copying {len(selected_edges)} edge(s)")

        # Serialize nodes with socket data
        serialized_nodes = [serialize_node_with_socket_data(node) for node in selected_nodes]
        serialized_edges = [edge.serialize() for edge in selected_edges]

        # LOG: Verify serialized node IDs
        serialized_ids = [node.get("id") for node in serialized_nodes]
        logger.info(f"[COPY] Serialized node IDs: {serialized_ids}")

        # Wrap in graph structure
        graph_data = {
            "nodes": serialized_nodes,
            "edges": serialized_edges
        }
        payload = {"graph": graph_data}

        # Return as JSON string (for clipboard)
        return {
            "success": True,
            "data": json.dumps(payload, indent=2)
        }
    except Exception as e:
        logger.error(f"Error copying selection: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to copy selection: {str(e)}")


class PasteGraphRequest(BaseModel):
    data: str  # JSON string of graph data
    position: NodePosition


@app.post("/api/graph/paste")
async def paste_graph(request: PasteGraphRequest, ):
    """Paste graph data (nodes and edges) at the given position."""
    scene_controller = get_local_scene_controller()

    try:
        # Parse JSON data
        data = json.loads(request.data)
        position = (request.position.x, request.position.y)

        # LOG: Print IDs of nodes being pasted (before stripping)
        if "graph" in data and "nodes" in data["graph"]:
            old_node_ids = []
            old_node_titles = []
            old_node_params = []
            for node_data in data["graph"]["nodes"]:
                old_id = node_data.get("id", "NO_ID")
                old_title = node_data.get("title", "unknown")
                old_params = node_data.get("parameters", {})
                old_node_ids.append(old_id)
                old_node_titles.append(old_title)
                old_node_params.append(old_params)

            logger.info(f"[PASTE] Pasting {len(old_node_ids)} node(s) with old IDs:")
            for old_id, title, params in zip(old_node_ids, old_node_titles, old_node_params):
                logger.info(f"  - Old Node ID: {old_id}, Title: {title}")
                logger.info(f"    Parameters: {params}")

        # CRITICAL: Remove IDs from serialized nodes before pasting to prevent conflicts
        # The paste operation will generate new IDs for all nodes
        if "graph" in data and "nodes" in data["graph"]:
            for node_data in data["graph"]["nodes"]:
                old_node_id = node_data.get("id")
                # Remove the ID so deserialize will create a new one
                if "id" in node_data:
                    del node_data["id"]
                # Also remove IDs from sockets to prevent conflicts
                for socket in node_data.get("input_sockets", []):
                    if "id" in socket:
                        del socket["id"]
                for socket in node_data.get("output_sockets", []):
                    if "id" in socket:
                        del socket["id"]
                logger.debug(f"Stripped ID {old_node_id} from node '{node_data.get('title', 'unknown')}' before paste")

        # Get current node IDs in graph before paste (to detect if originals change)
        existing_node_ids_before = {node.id for node in scene_controller.model.graph.nodes} if scene_controller.model.graph else set()
        logger.info(f"[PASTE] Existing node IDs before paste: {sorted(existing_node_ids_before)}")

        # Get current node IDs in graph before paste (to detect if originals change)
        existing_node_ids_before = {node.id for node in scene_controller.model.graph.nodes} if scene_controller.model.graph else set()
        logger.info(f"[PASTE] Existing node IDs before paste: {sorted(existing_node_ids_before)}")

        # Use scene controller's paste_graph_data method
        result = scene_controller.paste_graph_data(data, position)

        if not result.success:
            raise HTTPException(
                status_code=400,
                detail=result.message or "Failed to paste graph data"
            )

        # LOG: Print IDs of nodes after paste
        if scene_controller.model.graph:
            existing_node_ids_after = {node.id for node in scene_controller.model.graph.nodes}
            new_node_ids = existing_node_ids_after - existing_node_ids_before
            logger.info(f"[PASTE] New node IDs after paste: {sorted(new_node_ids)}")
            logger.info(f"[PASTE] All node IDs after paste: {sorted(existing_node_ids_after)}")

            # Check if any original node IDs changed
            changed_ids = existing_node_ids_before - existing_node_ids_after
            if changed_ids:
                logger.warning(f"[PASTE] ⚠️  ORIGINAL NODE IDS CHANGED/LOST: {sorted(changed_ids)}")

            # Log details of newly created nodes
            for node in scene_controller.model.graph.nodes:
                if node.id in new_node_ids:
                    params = {name: attr.value for name, attr in node.parameters.items()}
                    logger.info(f"  - New Node ID: {node.id}, Title: {node.title}, Parameters: {params}")

            # Also log all existing nodes to see if any changed
            logger.info("[PASTE] All nodes in graph after paste:")
            for node in scene_controller.model.graph.nodes:
                params = {name: attr.value for name, attr in node.parameters.items()}
                is_new = " (NEW)" if node.id in new_node_ids else ""
                logger.info(f"  - Node ID: {node.id}, Title: {node.title}, Parameters: {params}{is_new}")

        # TODO: Restore socket data after nodes are created
        # This requires tracking old->new socket ID mapping during paste_graph_data
        # For now, nodes will be pasted without computed data (they'll need to be re-executed)

        # Sync graph state to frontend via WebSocket
        # Note: We don't emit graph_state here because paste_graph_data already emits
        # node_model_created events for each new node. Emitting graph_state would
        # overwrite all nodes including originals, potentially losing parameter values.
        # The frontend will sync via the individual node_model_created events.

        return {
            "success": True,
            "message": result.message or "Graph pasted successfully"
        }
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON data: {str(e)}")
    except Exception as e:
        logger.error(f"Error pasting graph: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to paste graph: {str(e)}")


@app.get("/api/workspace/variables")
async def get_workspace_variables():
    """Get all variables from the variables registry."""
    try:
        # Serialize the variables registry data
        serialized_data = {}
        for key, value in variables_registry.data.items():
            serialized_data[key] = serialize_value(value)

        return {
            "success": True,
            "variables": serialized_data
        }
    except Exception as e:
        logger.error(f"Error getting workspace variables: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get workspace variables: {str(e)}")


@app.get("/api/graph/export-python")
async def export_graph_as_python():
    """Export the current graph as Python code."""
    scene_controller = get_local_scene_controller()

    try:
        result = scene_controller.export_graph_as_python_code()

        if not result.success:
            raise HTTPException(
                status_code=500,
                detail=result.message or "Failed to export graph as Python code"
            )

        code = (result.data or {}).get("code", "") if isinstance(result.data, dict) else ""
        warnings = (result.data or {}).get("warnings", []) if isinstance(result.data, dict) else []

        return {
            "success": True,
            "code": code,
            "warnings": warnings
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error exporting graph as Python: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to export graph: {str(e)}")


@app.get("/api/socket/{node_id}/{socket_id}/schema")
async def get_socket_schema(node_id: str, socket_id: str, ):
    """Get schema information from a socket's data."""
    scene_controller = get_local_scene_controller()

    try:
        # Find the node and socket
        graph = scene_controller.model.graph
        node_model = None
        for node in graph.nodes:
            if node.id == node_id:
                node_model = node
                break

        if not node_model:
            raise HTTPException(status_code=404, detail=f"Node {node_id} not found")

        # Find the socket (output socket only)
        socket_model = None
        for socket in node_model.output_sockets:
            if socket.id == socket_id:
                socket_model = socket
                break

        if not socket_model:
            raise HTTPException(status_code=404, detail=f"Socket {socket_id} not found")

        # Get data from socket
        data = socket_model.get_data()

        # If no data, try to execute the node first
        if data is None and node_model:
            from sciplex_core.controller.node_controller import NodeController
            node_controller = NodeController(node_model)
            node_controller.execute()
            data = socket_model.get_data()

        if data is None:
            return {
                "success": True,
                "schema": None,
                "message": "No data available. Please execute the node first."
            }

        # Extract schema
        from sciplex_core.utils.data_schema import extract_schema_from_data
        schema_info = extract_schema_from_data(data)

        # Serialize schema for JSON response
        if schema_info:
            serialized_schema = {}
            if "columns" in schema_info:
                serialized_schema["columns"] = schema_info["columns"]
            if "dtypes" in schema_info:
                serialized_schema["dtypes"] = {str(k): str(v) for k, v in schema_info["dtypes"].items()}
            if "shape" in schema_info:
                serialized_schema["shape"] = list(schema_info["shape"])
            if "sample" in schema_info:
                # Serialize sample data
                serialized_schema["sample"] = serialize_value(schema_info["sample"])

            return {
                "success": True,
                "schema": serialized_schema
            }
        else:
            return {
                "success": True,
                "schema": None,
                "message": "Schema extraction not supported for this data type"
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting socket schema: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get socket schema: {str(e)}")


# ============================================================================
# Health Check
# ============================================================================

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "libraries_loaded": len(library_model.get_library_items())
    }


class InstallPackageRequest(BaseModel):
    package_name: str
    version: Optional[str] = None  # Optional version specifier (e.g., "==1.2.3", ">=1.0.0")


@app.get("/api/packages")
async def list_installed_packages():
    """List all installed Python packages in the user's virtual environment."""
    # Local mode: Use system Python instead of per-user venv
    # from web.backend.auth.user_venv import get_user_python_executable, ensure_user_venv
    import sys as sys_module
    def get_user_python_executable(user_id):
        return sys_module.executable
    def ensure_user_venv(user_id):
        return True

    try:
        # Ensure user has a venv
        if not ensure_user_venv(None):
            raise HTTPException(
                status_code=500,
                detail="Failed to create or access user virtual environment"
            )

        python_executable = get_user_python_executable(None)
        if not python_executable:
            raise HTTPException(
                status_code=500,
                detail="Python executable not found in user virtual environment"
            )

        # Get Python version from the user's venv
        version_result = subprocess.run(
            [python_executable, "--version"],
            capture_output=True,
            text=True,
            timeout=10
        )
        python_version = version_result.stdout.strip() if version_result.returncode == 0 else "unknown"

        # Run pip list command in user's venv
        result = subprocess.run(
            [python_executable, "-m", "pip", "list", "--format=json"],
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode != 0:
            logger.error(f"Error listing packages: {result.stderr}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to list packages: {result.stderr}"
            )

        packages = json.loads(result.stdout)

        # Format packages for frontend
        formatted_packages = [
            {
                "name": pkg.get("name", ""),
                "version": pkg.get("version", ""),
            }
            for pkg in packages
        ]

        # Local mode: Use system Python path
        # from web.backend.auth.user_venv import get_user_venv_path
        # venv_path = get_user_venv_path(None)
        venv_path = Path(sys_module.executable).parent

        return {
            "success": True,
            "packages": formatted_packages,
            "environment": {
                "python_executable": python_executable,
                "python_version": python_version,
                "in_venv": True,
                "venv_path": str(venv_path),
            }
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Timeout while listing packages")
    except json.JSONDecodeError as e:
        logger.error(f"Error parsing pip list output: {e}")
        raise HTTPException(status_code=500, detail="Failed to parse package list")
    except Exception as e:
        logger.error(f"Error listing packages: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to list packages: {str(e)}")


@app.post("/api/packages/install")
async def install_package(request: InstallPackageRequest, ):
    """Install a Python package in the user's virtual environment."""
    # Local mode: Use system Python instead of per-user venv
    # from web.backend.auth.user_venv import get_user_python_executable, ensure_user_venv
    import sys as sys_module
    def get_user_python_executable(user_id):
        return sys_module.executable
    def ensure_user_venv(user_id):
        return True

    try:
        # Ensure user has a venv
        if not ensure_user_venv(None):
            raise HTTPException(
                status_code=500,
                detail="Failed to create or access user virtual environment"
            )

        python_executable = get_user_python_executable(None)
        if not python_executable:
            raise HTTPException(
                status_code=500,
                detail="Python executable not found in user virtual environment"
            )

        # Build pip install command
        package_spec = request.package_name
        if request.version:
            package_spec = f"{request.package_name}{request.version}"

        # Run pip install command in user's venv
        result = subprocess.run(
            [python_executable, "-m", "pip", "install", package_spec],
            capture_output=True,
            text=True,
            timeout=300  # 5 minutes timeout for package installation
        )

        if result.returncode != 0:
            logger.error(f"Error installing package {package_spec} for user {None}: {result.stderr}")
            raise HTTPException(
                status_code=400,
                detail=f"Failed to install package: {result.stderr}"
            )

        # Get the installed version from user's venv
        version_result = subprocess.run(
            [python_executable, "-m", "pip", "show", request.package_name],
            capture_output=True,
            text=True,
            timeout=30
        )

        installed_version = "unknown"
        if version_result.returncode == 0:
            for line in version_result.stdout.split("\n"):
                if line.startswith("Version:"):
                    installed_version = line.split(":", 1)[1].strip()
                    break

        return {
            "success": True,
            "message": f"Package '{request.package_name}' installed successfully",
            "version": installed_version,
            "output": result.stdout
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Timeout while installing package")
    except Exception as e:
        logger.error(f"Error installing package: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to install package: {str(e)}")


@app.get("/api/packages/search")
async def search_packages(q: str = Query(..., description="Search query")):
    """Search for packages on PyPI."""
    try:
        import requests  # type: ignore[import-untyped]
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="requests library not available. Install it with: pip install requests"
        )

    try:
        # PyPI's search page is JavaScript-rendered, so we can't easily parse it
        # Instead, we'll use a simpler approach: try to fetch the exact package name
        # and also check for common variations

        results = []

        # First, try the exact query as a package name
        exact_package = q.strip().lower()
        try:
            pkg_info_url = f"https://pypi.org/pypi/{exact_package}/json"
            pkg_response = requests.get(pkg_info_url, timeout=5)
            if pkg_response.status_code == 200:
                pkg_data = pkg_response.json()
                info = pkg_data.get("info", {})
                results.append({
                    "name": info.get("name", exact_package),
                    "version": info.get("version", ""),
                    "description": info.get("summary", "")[:200] if info.get("summary") else "",
                })
        except Exception as e:
            logger.debug(f"Exact package {exact_package} not found: {e}")

        # Also try common variations
        variations = []

        # Add 's' at the end (e.g., "statsmodel" -> "statsmodels")
        if not exact_package.endswith('s'):
            variations.append(exact_package + "s")

        # Remove 's' at the end (e.g., "statsmodels" -> "statsmodel")
        if exact_package.endswith('s'):
            variations.append(exact_package[:-1])

        # Replace common patterns
        if "model" in exact_package:
            variations.append(exact_package.replace("model", "models"))
            variations.append(exact_package.replace("models", "model"))

        # Remove duplicates
        variations = list(set(variations))

        for variation in variations:
            if variation == exact_package:
                continue  # Already tried
            if len(results) >= 10:
                break
            try:
                pkg_info_url = f"https://pypi.org/pypi/{variation}/json"
                pkg_response = requests.get(pkg_info_url, timeout=5)
                if pkg_response.status_code == 200:
                    pkg_data = pkg_response.json()
                    info = pkg_data.get("info", {})
                    # Check if we already have this package
                    if not any(r["name"].lower() == info.get("name", "").lower() for r in results):
                        results.append({
                            "name": info.get("name", variation),
                            "version": info.get("version", ""),
                            "description": info.get("summary", "")[:200] if info.get("summary") else "",
                        })
            except Exception:
                pass  # Variation doesn't exist, continue

        # If we still don't have results, try using HTML parsing as fallback
        if not results:
            try:
                from bs4 import BeautifulSoup

                search_url = f"https://pypi.org/search/?q={q}"
                headers = {"User-Agent": "Sciplex/1.0"}
                response = requests.get(search_url, headers=headers, timeout=10)

                if response.status_code == 200:
                    soup = BeautifulSoup(response.text, 'html.parser')

                    # Look for package links
                    package_links = soup.find_all('a', class_='package-snippet')
                    for link in package_links[:10]:
                        href = link.get('href', '')
                        if '/project/' in href:
                            package_name = href.split('/project/')[1].rstrip('/')
                            if package_name:
                                try:
                                    pkg_info_url = f"https://pypi.org/pypi/{package_name}/json"
                                    pkg_response = requests.get(pkg_info_url, timeout=5)
                                    if pkg_response.status_code == 200:
                                        pkg_data = pkg_response.json()
                                        info = pkg_data.get("info", {})
                                        results.append({
                                            "name": info.get("name", package_name),
                                            "version": info.get("version", ""),
                                            "description": info.get("summary", "")[:200] if info.get("summary") else "",
                                        })
                                        if len(results) >= 10:
                                            break
                                except Exception:
                                    pass
            except ImportError:
                # BeautifulSoup not available, skip HTML parsing
                logger.debug("BeautifulSoup not available for HTML parsing")
            except Exception as e:
                logger.debug(f"Error parsing HTML: {e}")

        return {
            "success": True,
            "results": results
        }

    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="requests library not available. Install it with: pip install requests"
        )
    except Exception as e:
        logger.error(f"Error searching PyPI: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to search PyPI: {str(e)}"
        )


@app.delete("/api/packages/{package_name}")
async def uninstall_package(package_name: str, ):
    """Uninstall a Python package from the user's virtual environment."""
    # Local mode: Use system Python instead of per-user venv
    # from web.backend.auth.user_venv import get_user_python_executable, ensure_user_venv
    import sys as sys_module
    def get_user_python_executable(user_id):
        return sys_module.executable
    def ensure_user_venv(user_id):
        return True

    try:
        # Ensure user has a venv
        if not ensure_user_venv(None):
            raise HTTPException(
                status_code=500,
                detail="Failed to create or access user virtual environment"
            )

        python_executable = get_user_python_executable(None)
        if not python_executable:
            raise HTTPException(
                status_code=500,
                detail="Python executable not found in user virtual environment"
            )

        # Run pip uninstall command in user's venv
        result = subprocess.run(
            [python_executable, "-m", "pip", "uninstall", "-y", package_name],
            capture_output=True,
            text=True,
            timeout=60
        )

        if result.returncode != 0:
            logger.error(f"Error uninstalling package {package_name} for user {None}: {result.stderr}")
            raise HTTPException(
                status_code=400,
                detail=f"Failed to uninstall package: {result.stderr}"
            )

        return {
            "success": True,
            "message": f"Package '{package_name}' uninstalled successfully",
            "output": result.stdout
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Timeout while uninstalling package")
    except Exception as e:
        logger.error(f"Error uninstalling package: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to uninstall package: {str(e)}")


# ============================================================================
# Frontend SPA Catch-All Route (must be last to not interfere with API routes)
# ============================================================================

@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    """Serve the frontend SPA for all non-API routes.
    
    This route must be defined LAST after all API routes to ensure proper
    route matching order in FastAPI.
    """
    # Don't serve index.html for API routes
    if full_path.startswith("api") or full_path.startswith("ws"):
        raise HTTPException(status_code=404, detail="Not found")

    # Check if frontend dist exists
    frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
    if not frontend_dist.exists():
        raise HTTPException(
            status_code=404,
            detail=(
                "Frontend not built. "
                "For development: cd sciplex/web/frontend && npm run build:local. "
                "For PyPI install: The frontend should be pre-built in the package."
            )
        )

    # Check if the requested path is a static file that exists
    requested_file = frontend_dist / full_path
    # Security: ensure the path is within the dist directory (prevent directory traversal)
    try:
        requested_file.resolve().relative_to(frontend_dist.resolve())
    except ValueError:
        # Path is outside dist directory, treat as 404
        raise HTTPException(status_code=404, detail="Not found")

    # If the file exists and is not a directory, serve it
    if requested_file.exists() and requested_file.is_file():
        return FileResponse(str(requested_file))

    # Otherwise, serve index.html for SPA routing
    index_file = frontend_dist / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    raise HTTPException(
        status_code=404,
        detail=(
            "Frontend not built. "
            "For development: cd sciplex/web/frontend && npm run build:local. "
            "For PyPI install: The frontend should be pre-built in the package."
        )
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

