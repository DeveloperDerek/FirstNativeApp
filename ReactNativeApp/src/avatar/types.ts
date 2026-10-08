export type AvatarConfig = {
  skin: string; // hex color
  hair: string | null; // item id, null = bald
  hairColor: string; // hex color
  face: string;
  top: string;
  bottom: string;
  shoes: string;
  hat: string | null;
};

export const DEFAULT_AVATAR: AvatarConfig = {
  skin: '#f6c9a0',
  hair: 'hair_spiky',
  hairColor: '#7a4a2a',
  face: 'face_smile',
  top: 'top_hoodie_red',
  bottom: 'bottom_shorts_blue',
  shoes: 'shoes_white',
  hat: null,
};

export const SKIN_TONES = ['#fde0c8', '#f6c9a0', '#e0a878', '#c68655', '#a86b45', '#6f4428'];

export const HAIR_COLORS = [
  '#2a1a1a',
  '#7a4a2a',
  '#c98a3c',
  '#f2d16b',
  '#d9534f',
  '#f48fb1',
  '#5b8def',
  '#e8e8e8',
];
