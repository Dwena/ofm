'use client'

import { useState, useEffect, useRef, ImgHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface LazyImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string
  alt: string
  fallback?: string
  threshold?: number
  rootMargin?: string
  blurDataURL?: string
  onLoad?: () => void
  onError?: () => void
}

export function LazyImage({
  src,
  alt,
  fallback = '/placeholder.png',
  threshold = 0.01,
  rootMargin = '50px',
  blurDataURL,
  className,
  onLoad,
  onError,
  ...props
}: LazyImageProps) {
  const [imageSrc, setImageSrc] = useState<string>(blurDataURL || fallback)
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    if (!imgRef.current) return

    // Create intersection observer
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // Load the image when it enters viewport
            const img = new Image()

            img.onload = () => {
              setImageSrc(src)
              setIsLoading(false)
              onLoad?.()
            }

            img.onerror = () => {
              setImageSrc(fallback)
              setHasError(true)
              setIsLoading(false)
              onError?.()
            }

            img.src = src

            // Stop observing once loaded
            observer.unobserve(entry.target)
          }
        })
      },
      {
        threshold,
        rootMargin,
      }
    )

    observer.observe(imgRef.current)

    return () => {
      if (imgRef.current) {
        observer.unobserve(imgRef.current)
      }
    }
  }, [src, fallback, threshold, rootMargin, onLoad, onError])

  return (
    <img
      ref={imgRef}
      src={imageSrc}
      alt={alt}
      loading="lazy"
      className={cn(
        'transition-opacity duration-300',
        isLoading && 'opacity-50 blur-sm',
        !isLoading && 'opacity-100',
        className
      )}
      {...props}
    />
  )
}

// Optimized image component with srcset support
interface ResponsiveImageProps extends LazyImageProps {
  srcSet?: string
  sizes?: string
}

export function ResponsiveImage({
  src,
  srcSet,
  sizes,
  ...props
}: ResponsiveImageProps) {
  return (
    <LazyImage
      src={src}
      srcSet={srcSet}
      sizes={sizes}
      {...props}
    />
  )
}

// Background image with lazy loading
interface LazyBackgroundProps {
  src: string
  className?: string
  children?: React.ReactNode
  fallback?: string
}

export function LazyBackground({
  src,
  className,
  children,
  fallback = '/placeholder.png',
}: LazyBackgroundProps) {
  const [backgroundImage, setBackgroundImage] = useState<string>(`url(${fallback})`)
  const [isLoading, setIsLoading] = useState(true)
  const divRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!divRef.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const img = new Image()

            img.onload = () => {
              setBackgroundImage(`url(${src})`)
              setIsLoading(false)
            }

            img.onerror = () => {
              setBackgroundImage(`url(${fallback})`)
              setIsLoading(false)
            }

            img.src = src
            observer.unobserve(entry.target)
          }
        })
      },
      {
        threshold: 0.01,
        rootMargin: '50px',
      }
    )

    observer.observe(divRef.current)

    return () => {
      if (divRef.current) {
        observer.unobserve(divRef.current)
      }
    }
  }, [src, fallback])

  return (
    <div
      ref={divRef}
      className={cn(
        'bg-cover bg-center transition-all duration-300',
        isLoading && 'blur-sm',
        className
      )}
      style={{ backgroundImage }}
    >
      {children}
    </div>
  )
}
