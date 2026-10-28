import time
from typing import Any, Dict, Optional
from pydantic import BaseModel, Field

class WebSocketEvent(BaseModel):
    event_type: str = Field(..., description="Type of network event")
    timestamp: float = Field(default_factory=time.time)
    data: Dict[str, Any] = Field(default_factory=dict)
    message: Optional[str] = None

class EventLogEntry(BaseModel):
    id: Optional[int] = None
    timestamp: float
    level: str  # 'INFO', 'WARNING', 'ERROR', 'SUCCESS'
    source: str # 'CONTROLLER', 'MININET', 'EXPERIMENT', 'SYSTEM'
    message: str
    details: Dict[str, Any] = {}
