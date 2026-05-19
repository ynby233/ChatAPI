from .admin import register_admin_routes
from .auth import register_auth_routes
from .conversations import register_conversation_routes
from .realtime import register_realtime_routes
from .statistics import register_statistics_routes
from .responses import register_response_routes
from .uploads import register_upload_routes
from .user_api_keys import register_user_api_key_routes
from .user_config import register_user_config_routes

__all__ = [
    "register_admin_routes",
    "register_auth_routes",
    "register_conversation_routes",
    "register_realtime_routes",
    "register_statistics_routes",
    "register_response_routes",
    "register_upload_routes",
    "register_user_api_key_routes",
    "register_user_config_routes",
]
