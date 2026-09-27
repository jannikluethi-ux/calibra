import clsx from "clsx";

export function Panel({
  title,
  right,
  children,
  className,
}: {
  title?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("panel overflow-hidden", className)}>
      {title && (
        <div className="panel-header">
          <span>{title}</span>
          {right}
        </div>
      )}
      <div className="p-3">{children}</div>
    </section>
  );
}
