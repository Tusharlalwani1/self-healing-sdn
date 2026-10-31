import json,pathlib,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]))
from backend.main import app
spec=app.openapi()
out=pathlib.Path(__file__).parent
(out/'openapi-source.json').write_text(json.dumps(spec,indent=2))
routes=[dict(path=path,method=method.upper(),operationId=op.get('operationId')) for path,methods in spec['paths'].items() for method,op in methods.items()]
(out/'route-inventory.json').write_text(json.dumps(routes,indent=2))
print('Source HTTP operations:',len(routes),'plus /ws/events and static files')
