// SNMP is not supported on Vercel (no process spawning)
module.exports = (req, res) => {
  res.status(501).json({ error: 'SNMP wird in der Cloud-Version nicht unterstützt.' });
};
