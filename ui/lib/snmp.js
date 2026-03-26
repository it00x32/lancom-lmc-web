export function snmpReqBody(host, type) {
  const ver = localStorage.getItem('snmpVersion') || '2c';
  const community = localStorage.getItem('snmpReadCommunity') || 'public';
  if (ver === '3') {
    return {
      host, version: '3', type,
      v3Username: localStorage.getItem('snmpV3Username') || '',
      v3SecLevel: localStorage.getItem('snmpV3SecLevel') || 'authPriv',
      v3AuthProto: localStorage.getItem('snmpV3AuthProto') || 'SHA',
      v3AuthPass: localStorage.getItem('snmpV3AuthPass') || '',
      v3PrivProto: localStorage.getItem('snmpV3PrivProto') || 'AES',
      v3PrivPass: localStorage.getItem('snmpV3PrivPass') || '',
    };
  }
  return { host, community, version: ver, type };
}
