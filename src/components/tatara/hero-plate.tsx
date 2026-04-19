import { cn } from "@/lib/utils";

export function HeroPlate({
  image,
  children,
  alt = "",
  topFade = true,
  bottomFade = true,
  className,
}: {
  image: string;
  children: React.ReactNode;
  alt?: string;
  topFade?: boolean;
  bottomFade?: boolean;
  className?: string;
}) {
  return (
    <section className={cn("relative w-full overflow-hidden", className)}>
      <img src={image} alt={alt} className="absolute inset-0 w-full h-full object-cover" />
      {topFade && (
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-[120px] pointer-events-none"
          style={{ background: "linear-gradient(to bottom, rgba(27,20,16,0.35), rgba(27,20,16,0))" }}
        />
      )}
      {bottomFade && (
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[160px] pointer-events-none"
          style={{ background: "linear-gradient(to bottom, rgba(245,239,227,0), rgba(245,239,227,0.5), #F5EFE3)" }}
        />
      )}
      <div className="relative z-10">{children}</div>
    </section>
  );
}
