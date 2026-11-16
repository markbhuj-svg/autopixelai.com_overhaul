export const guidedSide = {
  id: 'capture-side', width: 1440, height: 810,
  alt: 'The phone shows a side-profile outline and tire alignment guide over a parked SUV.',
};

export const photoWorkflow = [
  {
    id: 'scan-vin', label: 'Scan VIN', title: 'Scan the VIN.',
    description: 'Point the app at the VIN on the door jamb to start a photo set for that vehicle.',
    frames: [{
      id: 'scan-vin', width: 844, height: 1500,
      alt: 'A phone frames the VIN barcode on the vehicle’s door jamb.',
    }],
  },
  {
    id: 'select-theme', label: 'Select a theme', title: 'Select a theme.',
    description: 'Choose the showroom or studio background you want for the finished photos.',
    link: { href: '/virtual-showrooms/', label: 'Explore showroom themes' },
    frames: [{
      id: 'select-theme', width: 844, height: 1500,
      alt: 'The app lists showroom and studio templates with a preview of each setting.',
    }],
  },
  {
    id: 'capture-images', label: 'Guide each shot', title: 'Capture frame by frame.',
    description: 'Match the vehicle to the on-screen outline. Guided frames help your team repeat the same angles across your inventory.',
    frames: [{
      id: 'capture-front', width: 1440, height: 810,
      alt: 'A phone displays a blue alignment outline over the front three-quarter view of an SUV.',
    }, guidedSide],
  },
  {
    id: 'delivered-results', label: 'Get your results', title: 'Get the finished photos.',
    description: 'Review the delivered exterior, detail, and interior shots as one set. Download the photos or send them to your connected publishing workflow.',
    link: { href: '/integrations/', label: 'Explore delivery options' },
    frames: [{
      id: 'delivered-photos', width: 844, height: 1500,
      alt: 'A phone displays the delivered gallery, including showroom views, close-ups, and interior photos.',
    }],
  },
];

export const photoFramePath = (id: string) => `/media/photo-app/${id}.webp`;
