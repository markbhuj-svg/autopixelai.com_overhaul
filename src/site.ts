export const liveSite = 'https://www.autopixelai.com';
export const bookingUrl = '/book-a-demo/';
export const tryPhotoUrl = '/try-it/';
export const campaignUrl = '/BlackFriday';

export const signInUrl = 'https://crm.autopixelai.com/';

export const integrationPartners = [
  'DealerOn', 'TRADER', 'AutoTrader.ca', 'HomeNet', '360.Agency', 'D2C Media', 'vAuto', 'AutoVision', 'CarGurus',
];

export const siteLinks = [
  { href: '/photo-app/', label: 'Photo App' },
  { href: '/virtual-showrooms/', label: 'Showrooms' },
  { href: '/integrations/', label: 'Integrations & Partners' },
  { href: tryPhotoUrl, label: 'Try a Photo' },
];

export const launchPaths = ['/', ...siteLinks.map(({ href }) => href), bookingUrl, campaignUrl];
