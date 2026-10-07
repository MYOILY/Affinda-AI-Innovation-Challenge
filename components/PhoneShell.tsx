/**
 * iPhone 18 Pro body: 150.0 × 71.9 mm (5.91 × 2.83 in). On a laptop this is Mo's phone, so a
 * recording still looks like the pocket tool. On a real phone the chrome goes away.
 */
export default function PhoneShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-stretch justify-center bg-slate-100 md:items-center md:bg-[#0b1020] md:px-8 md:py-6">
      <div className="flex w-full flex-col items-center md:w-auto">
        <div className="iphone-18-pro relative h-dvh w-full overflow-hidden">
          {/* Left: Action button, volume up, volume down */}
          <div className="pointer-events-none absolute -left-[4px] top-[14%] hidden h-7 w-[4px] rounded-l-sm bg-[#c4bfb8] md:block" />
          <div className="pointer-events-none absolute -left-[4px] top-[22%] hidden h-12 w-[4px] rounded-l-sm bg-[#c4bfb8] md:block" />
          <div className="pointer-events-none absolute -left-[4px] top-[30%] hidden h-12 w-[4px] rounded-l-sm bg-[#c4bfb8] md:block" />
          {/* Right: power, Camera Control */}
          <div className="pointer-events-none absolute -right-[4px] top-[22%] hidden h-[68px] w-[4px] rounded-r-sm bg-[#c4bfb8] md:block" />
          <div className="pointer-events-none absolute -right-[5px] top-[42%] hidden h-11 w-[5px] rounded-full bg-[#d8d3cc] md:block" />

          <div className="h-full overflow-hidden bg-slate-100 md:rounded-[3.1rem] md:bg-[linear-gradient(160deg,#d9d4cc_0%,#9a948c_28%,#6f6a64_55%,#b7b1a8_78%,#8a8580_100%)] md:p-[8px] md:shadow-[0_50px_90px_rgba(0,0,0,0.55)] md:ring-1 md:ring-white/25">
            {/* Inner glass lip */}
            <div className="h-full overflow-hidden bg-black md:rounded-[2.55rem] md:p-[3px]">
              <div className="pointer-events-none absolute left-1/2 top-[16px] z-30 hidden h-[30px] w-[102px] -translate-x-1/2 rounded-full bg-black shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] md:block" />
              <div className="h-full min-h-0 min-w-0 overflow-hidden bg-slate-100 md:rounded-[2.4rem]">{children}</div>
            </div>
            <div className="pointer-events-none absolute bottom-[5px] left-1/2 hidden h-[4px] w-[120px] -translate-x-1/2 rounded-full bg-black/40 md:block" />
          </div>
        </div>
        <p className="mt-4 hidden text-center text-sm text-zinc-400 md:block">iPhone 18 Pro · 150 × 71.9 mm · Mo&apos;s phone</p>
      </div>
    </div>
  );
}
