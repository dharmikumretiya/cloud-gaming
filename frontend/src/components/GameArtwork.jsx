const presentation = {
  flare: { wide: '/images/flare.jpg', developer: 'Flare contributors', genre: 'Action RPG · Account saves', controller: false },
  mahjongg: { wide: '/images/mahjongg.png', cover: '/images/mahjongg-banner.png', developer: 'GNOME contributors', genre: 'Touch puzzle', controller: false, touch: true },
  supertuxkart: { wide: '/images/stk-world.jpg', cover: '/images/stk-cover.jpg', developer: 'SuperTuxKart Team', genre: 'Arcade racing', controller: true },
  xonotic: { wide: '/images/xonotic.jpg', developer: 'Team Xonotic', genre: 'Arena shooter', controller: false },
  supertux: { wide: '/images/supertux.png', developer: 'SuperTux Team', genre: 'Platform adventure', controller: true },
  openttd: { wide: '/images/openttd.png', developer: 'OpenTTD developers', genre: 'Transport simulation', controller: false },
};
export const isSuperTuxKart = game => game?.launchId === 'supertuxkart';
export const gamePresentation = game => presentation[game?.launchId] || { genre: 'Host-installed game', controller: false };
export function gameArt(game, format = 'wide') {
  const art = gamePresentation(game);
  return (format === 'cover' && art.cover) || art.wide || game?.imageUrl || '/images/supertuxkart.svg';
}
export default function GameArtwork({ game, format = 'wide', ...props }) {
  return <img src={gameArt(game, format)} alt="" {...props}/>;
}
