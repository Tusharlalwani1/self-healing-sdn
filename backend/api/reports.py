from fastapi import APIRouter, HTTPException, Query, Response
from backend.database.db import get_experiment_by_id, get_experiments
from backend.services.report_generator import report_generator

router = APIRouter(prefix="/api/reports", tags=["Reports"])

@router.get("/{exp_id}/export")
async def export_experiment(exp_id: str, format: str = Query("json", pattern="^(json|csv|html)$")):
    exp = get_experiment_by_id(exp_id)
    if not exp:
        raise HTTPException(status_code=404, detail="Experiment not found")

    if format == "json":
        content = report_generator.generate_json(exp)
        return Response(content=content, media_type="application/json", headers={
            "Content-Disposition": f'attachment; filename="report_{exp_id}.json"'
        })
    elif format == "csv":
        content = report_generator.generate_csv([exp])
        return Response(content=content, media_type="text/csv", headers={
            "Content-Disposition": f'attachment; filename="report_{exp_id}.csv"'
        })
    elif format == "html":
        content = report_generator.generate_html_report(exp)
        return Response(content=content, media_type="text/html", headers={
            "Content-Disposition": f'attachment; filename="report_{exp_id}.html"'
        })

@router.get("/export-all")
async def export_all(format: str = Query("csv", pattern="^(json|csv)$")):
    exps = get_experiments(limit=500)
    if format == "json":
        return Response(content=report_generator.generate_json(exps), media_type="application/json")
    else:
        content = report_generator.generate_csv(exps)
        return Response(content=content, media_type="text/csv", headers={
            "Content-Disposition": 'attachment; filename="all_experiments.csv"'
        })
