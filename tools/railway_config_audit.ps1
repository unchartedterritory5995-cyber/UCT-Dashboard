# railway_config_audit.ps1 - thin Task Scheduler wrapper for railway_config_audit.py
# Exit codes pass through: 0 pass / 1 drift / 2 script-error.
$ErrorActionPreference = 'Continue'
$script = Join-Path $PSScriptRoot 'railway_config_audit.py'
python $script @args
exit $LASTEXITCODE
