const BRAND_VIDEO_SRC = '/media/topbar-logo.mp4'

export default function BrandVideo({ className = 'brand-video', ariaLabel = 'VOLT logo' }) {
  return (
    <video className={className} autoPlay loop muted playsInline preload="auto" aria-label={ariaLabel}>
      <source src={BRAND_VIDEO_SRC} type="video/mp4" />
    </video>
  )
}
