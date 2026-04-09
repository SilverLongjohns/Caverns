interface CompassProps {
  exits: Partial<Record<string, string>>;
}

export function Compass({ exits }: CompassProps) {
  return (
    <div className="compass">
      <div className="compass-row">
        <span className={`compass-key ${exits.north ? 'compass-active' : 'compass-inactive'}`}>W</span>
      </div>
      <div className="compass-row">
        <span className={`compass-key ${exits.west ? 'compass-active' : 'compass-inactive'}`}>A</span>
        <span className="compass-dot">+</span>
        <span className={`compass-key ${exits.east ? 'compass-active' : 'compass-inactive'}`}>D</span>
      </div>
      <div className="compass-row">
        <span className={`compass-key ${exits.south ? 'compass-active' : 'compass-inactive'}`}>S</span>
      </div>
    </div>
  );
}
