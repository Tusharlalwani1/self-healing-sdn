"""JSON-safe validation errors on routes accepting service intent policies."""
from fastapi import HTTPException
from fastapi.exceptions import RequestValidationError
from backend.api.runtime_route import RuntimeRoute


class IntentRoute(RuntimeRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def intent_handler(request):
            try:
                return await handler(request)
            except RequestValidationError as exc:
                # Non-standard NaN/Infinity JSON can reach Pydantic, whose raw
                # input/context cannot be serialized by Starlette's JSONResponse.
                # Preserve validation locations/messages without echoing raw input.
                raise HTTPException(422, detail=[{key: error[key] for key in ('loc', 'msg', 'type')}
                                                for error in exc.errors()]) from exc

        return intent_handler
