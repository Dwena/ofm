"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

export interface SliderProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "value" | "defaultValue" | "onChange" | "type"
  > {
  value?: number[]
  defaultValue?: number[]
  min?: number
  max?: number
  step?: number
  onValueChange?: (value: number[]) => void
}

// Single-thumb slider with the same value/onValueChange API as Radix Slider
const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  (
    {
      className,
      value,
      defaultValue,
      min = 0,
      max = 100,
      step = 1,
      onValueChange,
      ...props
    },
    ref
  ) => {
    const current = value?.[0] ?? defaultValue?.[0] ?? min
    const percentage = max > min ? ((current - min) / (max - min)) * 100 : 0

    return (
      <input
        ref={ref}
        type="range"
        min={min}
        max={max}
        step={step}
        value={current}
        onChange={(e) => onValueChange?.([Number(e.target.value)])}
        className={cn(
          "h-1 w-full cursor-pointer appearance-none rounded-full bg-white/20 accent-primary",
          className
        )}
        style={{
          background: `linear-gradient(to right, hsl(var(--primary)) ${percentage}%, transparent ${percentage}%)`,
        }}
        {...props}
      />
    )
  }
)
Slider.displayName = "Slider"

export { Slider }
