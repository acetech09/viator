/** 32px EVE type icon (item or ship hull) from the public image server. */
export function ItemIcon({ typeId }: { typeId: number }) {
  return (
    <img
      className="item-icon"
      src={`https://images.evetech.net/types/${typeId}/icon?size=32`}
      alt=""
      loading="lazy"
    />
  );
}
