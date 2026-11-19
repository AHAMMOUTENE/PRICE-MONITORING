// Lance l'API (http://127.0.0.1:8787) et le site (http://127.0.0.1:5173) ensemble, branchés sur la base de api/.env.
import { spawn } from 'node:child_process'
const run = (name, dir, args) => {
  const p = spawn('npm', args, { cwd: new URL(dir, import.meta.url), stdio: 'inherit', shell: true })
  p.on('exit', (code) => {
    console.log(`[${name}] arrêté (${code})`)
    process.exit(code ?? 1)
  })
  return p
}
const procs = [run('api', './api/', ['run', 'dev']), run('site', './app/', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173', '--strictPort'])]
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => procs.forEach((p) => p.kill()))
