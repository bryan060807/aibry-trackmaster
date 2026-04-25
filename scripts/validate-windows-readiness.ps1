$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

function Invoke-NativeChecked {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ArgumentList
  )

  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath $($ArgumentList -join ' ') failed with exit code $LASTEXITCODE"
  }
}

Invoke-NativeChecked -FilePath node -ArgumentList @("-e", "const fs=require('node:fs'); const required=['package.json','trackmaster-api/package.json','trackmaster-ui/package.json','server/index.js','src/lib/api.ts','docs/windows-readiness-runbook.md','docs/cutover/trackmaster-windows-runtime-readiness-checklist.md','docs/cutover/trackmaster-production-env-switch-template.md','docs/cutover/trackmaster-freeze-window-checklist.md','docs/cutover/trackmaster-source-of-truth-handoff-checklist.md','docs/cutover/trackmaster-post-cutover-validation-checklist.md','docs/cutover/trackmaster-rollback-execution-worksheet.md']; for (const file of required) { if (!fs.existsSync(file)) throw new Error('Missing required artifact: '+file); } const ignored=fs.readFileSync('.gitignore','utf8'); for (const entry of ['dist/','data/','data-windows-readiness/','trackmaster-api/reports/']) { if (!ignored.includes(entry)) throw new Error('Missing .gitignore entry: '+entry); } const rootPkg=JSON.parse(fs.readFileSync('package.json','utf8')); for (const script of ['build','check:api','start:windows-readiness','pm2:windows-readiness:start']) { if (!rootPkg.scripts?.[script]) throw new Error('Missing root script: '+script); } const apiPkg=JSON.parse(fs.readFileSync('trackmaster-api/package.json','utf8')); for (const script of ['check','test','validate:postgres-runtime']) { if (!apiPkg.scripts?.[script]) throw new Error('Missing trackmaster-api script: '+script); } const reexport=fs.readFileSync('src/lib/api.ts','utf8'); if (!reexport.includes('../../trackmaster-ui/src/lib/apiClient')) throw new Error('src/lib/api.ts must continue to re-export the shared trackmaster-ui API client'); console.log('Runtime tree, docs packet, and generated-path ignores OK');")
Invoke-NativeChecked -FilePath node -ArgumentList @("--check", "server/index.js")
Invoke-NativeChecked -FilePath npm.cmd -ArgumentList @("--prefix", "trackmaster-api", "run", "check")
Invoke-NativeChecked -FilePath node -ArgumentList @("-e", "const cfg=require('./ecosystem.windows-readiness.config.cjs'); const app=cfg.apps && cfg.apps[0]; if(!app) throw new Error('missing PM2 app'); if(app.name!=='trackmaster-windows-readiness-api') throw new Error('unexpected PM2 app name'); if(app.env.TRACKMASTER_HOST!=='127.0.0.1') throw new Error('Windows readiness PM2 must bind to localhost'); if(app.env.TRACKMASTER_REPOSITORY_BACKEND!=='sqlite') throw new Error('Windows readiness PM2 must stay on sqlite'); console.log('PM2 windows-readiness config OK');")
Invoke-NativeChecked -FilePath npm.cmd -ArgumentList @("run", "build")
