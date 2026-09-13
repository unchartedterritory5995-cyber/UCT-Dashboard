import json
d = json.load(open(r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\5fdcc575-4f52-479e-98de-94a56d52ccfb\scratchpad\rstatus.json"))
for env in d['environments']['edges']:
    for si in env['node']['serviceInstances']['edges']:
        node = si['node']
        if node['serviceName'] == 'web':
            ld = node.get('latestDeployment') or {}
            print('service:', node['serviceName'])
            print('deployment id:', ld.get('id'))
            print('status:', ld.get('status'))
