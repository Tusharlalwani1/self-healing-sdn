"""Consistent HTTP errors for runtime routes, without leaking raw exceptions."""
import logging
from fastapi import HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from backend.services.operation_error import OperationError, public_error


class RuntimeRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def runtime_handler(request):
            try:
                return await handler(request)
            except OperationError as exc:
                detail = {"message": public_error(exc)}
                if exc.results is not None:
                    detail["results"] = exc.results
                raise HTTPException(exc.status_code, detail=detail) from exc
            except (HTTPException, RequestValidationError):
                raise
            except Exception as exc:
                logging.getLogger("sdn.api").exception("Runtime request failed: %s", request.url.path)
                raise HTTPException(500, detail={"message": public_error(exc)}) from exc

        return runtime_handler
