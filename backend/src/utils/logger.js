const stamp = () => new Date().toISOString();

const write = (stream, level, args) => {
  stream(`[${stamp()}] ${level}`, ...args);
};

export const logger = {
  info: (...args) => write(console.log, 'INFO ', args),
  warn: (...args) => write(console.warn, 'WARN ', args),
  error: (...args) => write(console.error, 'ERROR', args),
  debug: (...args) => {
    if (process.env.DEBUG) write(console.log, 'DEBUG', args);
  },
};

export default logger;
