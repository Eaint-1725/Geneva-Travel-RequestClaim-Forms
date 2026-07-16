"use client";

import React from "react";

// SIM-309 R3 (audit B1): ONE button primitive so sizing/padding is consistent
// (the audit found 5+ padding combos for the primary button). Variants cover the
// shapes already in use; sizes capture the two standard heights. Colour discipline
// is preserved — primary is the brand blue (SIM-445); agent indigo is never a Button variant.
type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover",
  secondary: "border border-gray-300 text-gray-600 hover:bg-gray-100",
  ghost: "text-gray-500 hover:bg-gray-100 hover:text-gray-700",
  danger: "bg-red-600 text-white hover:bg-red-700",
};
const SIZE_CLASS: Record<Size, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className = "", type = "button", ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      data-shared-button={variant}
      className={`rounded font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${SIZE_CLASS[size]} ${VARIANT_CLASS[variant]} ${className}`}
      {...props}
    />
  );
});

export default Button;
