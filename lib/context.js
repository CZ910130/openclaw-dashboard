const path = require('path');
const os = require('os');

const APP_DIR = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.DASHBOARD_PORT || '7000');
const OPENCLAW_DIR = process.env.OPENCLAW_DIR || path.join(os.homedir(), '.openclaw');
const DEFAULT_WORKSPACE_DIR = path.join(OPENCLAW_DIR, 'workspace');
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || process.env.OPENCLAW_WORKSPACE || DEFAULT_WORKSPACE_DIR;
const AGENT_ID = process.env.OPENCLAW_AGENT || 'main';

const sessDir = path.join(OPENCLAW_DIR, 'agents', AGENT_ID, 'sessions');
const cronFile = path.join(OPENCLAW_DIR, 'cron', 'jobs.json');
const dataDir = path.join(APP_DIR, 'data');
const memoryDir = path.join(WORKSPACE_DIR, 'memory');
const memoryMdPath = path.join(WORKSPACE_DIR, 'MEMORY.md');
const heartbeatPath = path.join(WORKSPACE_DIR, 'HEARTBEAT.md');
const healthHistoryFile = path.join(dataDir, 'health-history.json');
const AUTH_DATA_DIR = process.env.DASHBOARD_AUTH_DIR || dataDir;
const auditLogPath = path.join(AUTH_DATA_DIR, 'audit.log');
const credentialsFile = path.join(AUTH_DATA_DIR, 'credentials.json');
const mfaSecretFile = path.join(AUTH_DATA_DIR, 'mfa-secret.txt');

const skillsDir = path.join(WORKSPACE_DIR, 'skills');
const configFiles = [
  { name: 'openclaw-gateway.service', path: path.join(os.homedir(), '.config/systemd/user/openclaw-gateway.service') },
  { name: 'openclaw-config.json',     path: path.join(os.homedir(), '.openclaw/config.json') },
];
const workspaceFilenames = ['AGENTS.md','HEARTBEAT.md','IDENTITY.md','MEMORY.md','SOUL.md','TOOLS.md','USER.md'];
const READ_ONLY_FILES = new Set(['openclaw-gateway.service', 'openclaw-config.json']);

module.exports = {
  APP_DIR,
  PORT,
  OPENCLAW_DIR,
  WORKSPACE_DIR,
  AGENT_ID,
  sessDir,
  cronFile,
  dataDir,
  memoryDir,
  memoryMdPath,
  heartbeatPath,
  healthHistoryFile,
  AUTH_DATA_DIR,
  auditLogPath,
  credentialsFile,
  mfaSecretFile,
  skillsDir,
  configFiles,
  workspaceFilenames,
  READ_ONLY_FILES
};
