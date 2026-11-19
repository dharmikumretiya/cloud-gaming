import { createHash, randomBytes } from 'node:crypto';
const cookieName = 'orbit_device';
function tokenFrom(req) {
  const cookies = (req.headers.cookie || '').split(';').map(value => value.trim());
  const token = cookies.find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  return /^[a-f0-9]{64}$/.test(token || '') ? token : null;
}
export function deviceOwner(req) {
  const token = tokenFrom(req);
  return token ? createHash('sha256').update(token).digest('hex') : null;
}
export function identifyDevice(config) {
  return (req, res, next) => {
    let token = tokenFrom(req);
    if (!token) {
      token = randomBytes(32).toString('hex');
      res.cookie(cookieName, token, { httpOnly: true, secure: Boolean(config.tls), sameSite: 'strict', path: '/', maxAge: 90 * 86400000 });
    }
    req.ownerId = createHash('sha256').update(token).digest('hex');
    next();
  };
}
