import ast, pathlib, json, sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]))
from backend.models.schemas import TrafficStartRequest, ExperimentRunRequest, ControllerSelectRequest
records=[]
for cls,payload in [(TrafficStartRequest,dict(interval=-1,count=-3,src='missing',dst='s1')),(TrafficStartRequest,dict(interval=0,count=0)),(ExperimentRunRequest,dict(controller='invalid',packet_count=-2,failure_delay_sec=-1,repetitions=0)),(ControllerSelectRequest,dict(controller_type='invalid'))]:
    try: records.append(dict(model=cls.__name__,input=payload,accepted=cls(**payload).model_dump()))
    except Exception as e: records.append(dict(model=cls.__name__,input=payload,error=str(e)))
root=pathlib.Path(__file__).resolve().parents[2]
files=[*root.glob('backend/**/*.py'),*root.glob('controller*.py'),*root.glob('SDN_controllers/*.py'),*root.glob('report_command_snips/*.py'),*root.glob('topology/*.py'),root/'topo_diamond.py']
for f in files:
    try: ast.parse(f.read_text()); records.append(dict(syntax=str(f.relative_to(root)),result='PASS'))
    except Exception as e: records.append(dict(syntax=str(f),error=str(e)))
(pathlib.Path(__file__).parent/'schema-syntax-evidence.json').write_text(json.dumps(records,indent=2))
print('Schema/syntax results saved',len(records))
