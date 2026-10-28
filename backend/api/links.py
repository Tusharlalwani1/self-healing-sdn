from fastapi import APIRouter, HTTPException
from backend.models.schemas import LinkActionRequest
from backend.services.mininet_client import mininet_client

router = APIRouter(prefix="/api/links", tags=["Links"])

@router.post("/down")
async def link_down(req: LinkActionRequest):
    try:
        return await mininet_client.set_link_status(req.node1, req.node2, "down")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/up")
async def link_up(req: LinkActionRequest):
    try:
        return await mininet_client.set_link_status(req.node1, req.node2, "up")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/restore-all")
async def restore_all_links():
    # Diamond topology links
    links = [
        ("h1", "s1"),
        ("h2", "s4"),
        ("s1", "s2"),
        ("s2", "s4"),
        ("s1", "s3"),
        ("s3", "s4")
    ]
    results = []
    for n1, n2 in links:
        res = await mininet_client.set_link_status(n1, n2, "up")
        results.append(res)
    return {"status": "ok", "message": "All links restored", "results": results}
