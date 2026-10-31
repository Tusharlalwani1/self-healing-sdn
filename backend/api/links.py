from backend.api.runtime_route import RuntimeRoute
from fastapi import APIRouter, HTTPException
from backend.models.schemas import LinkActionRequest
from backend.services.mininet_client import mininet_client
from backend.services.operation_error import OperationError, public_error

router = APIRouter(prefix="/api/links", tags=["Links"], route_class=RuntimeRoute)

@router.post("/down")
async def link_down(req: LinkActionRequest):
    return await mininet_client.set_link_status(req.node1, req.node2, "down")

@router.post("/up")
async def link_up(req: LinkActionRequest):
    return await mininet_client.set_link_status(req.node1, req.node2, "up")

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
        try:
            res = await mininet_client.set_link_status(n1, n2, "up")
            results.append({"node1": n1, "node2": n2, "status": "ok", "result": res})
        except Exception as exc:
            results.append({"node1": n1, "node2": n2, "status": "error",
                            "http_status": exc.status_code if isinstance(exc, OperationError) else 500,
                            "message": public_error(exc)})
    failed = [r for r in results if r["status"] == "error"]
    if failed:
        # Preserve a uniform state/dependency error if none succeeded; mixed
        # outcomes are an aggregate runtime failure, never HTTP 207/2xx.
        codes = {r["http_status"] for r in failed}
        code = next(iter(codes)) if len(failed) == len(links) and len(codes) == 1 else 502
        raise OperationError(code, f"Link restoration failed for {len(failed)} of {len(links)} links", results=results)
    return {"status": "ok", "message": "All links restored", "results": results}
