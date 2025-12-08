# Autosizing & UI Improvements - Strategic Recommendations

## Current Issues Identified

### 1. **Global CSS Word-Break Over-Aggression**
**Problem:** `global.css` has aggressive `word-break: break-word` rules applied globally (lines 242-274), causing words like "Ech-elon" to break inappropriately.

**Impact:** 
- Brand names and proper nouns break mid-word
- Exercise names wrap awkwardly
- Poor visual hierarchy and readability

**Recommendation:**
- Remove global `word-break: break-word` from `*` selector
- Use `overflow-wrap: break-word` (softer, only breaks when necessary)
- Apply `word-break: break-word` selectively to specific containers (tables, long-form text)
- Use `white-space: nowrap` + `text-overflow: ellipsis` for labels, names, titles

### 2. **Inconsistent Font Sizing Strategy**

**Problem:** Mix of approaches:
- CSS variables with `clamp()` using viewport units (`--text-xs: clamp(10px, 2.5vw, 11px)`)
- JavaScript-calculated font sizes in ShareCard
- Hardcoded pixel values in some components
- No unified typography scale

**Impact:**
- Inconsistent sizing across pages
- Viewport-based scaling can be too aggressive on small screens
- JavaScript calculations add complexity and potential layout shifts

**Recommendation:**
- **Adopt a unified typography scale** using CSS custom properties
- Use `rem` units instead of `vw` for more predictable scaling
- Define breakpoints for mobile/tablet/desktop
- Use `clamp()` with `rem` and viewport-relative units: `clamp(0.875rem, 2vw + 0.5rem, 1rem)`
- Reserve JavaScript font sizing only for truly dynamic content (like ShareCard grid)

### 3. **ShareCard Autosizing Complexity**

**Problem:** ShareCard uses complex JavaScript calculations:
- Character width estimation (`minCharWidth = 5.5px`)
- Multiple iterations to find optimal columns
- Scale factor calculations that can go below readable thresholds (min 7px)
- Hardcoded card dimensions (500px × 600px)

**Impact:**
- Text can become unreadably small
- Calculations may not account for actual rendered text width
- Doesn't adapt to actual viewport size

**Recommendation:**
- **Use CSS Grid with `auto-fit` and `minmax()`** for responsive columns
- Implement **CSS Container Queries** (when widely supported) for component-level responsiveness
- Use **`fit-content()`** and **`min()`/`max()`** CSS functions
- Consider **CSS `font-size: clamp()`** with container-relative units
- Measure actual text width using `ResizeObserver` or `getBoundingClientRect()` if JS is needed
- Set minimum readable font size (12px for body, 10px for labels)

### 4. **Viewport Unit Inconsistencies**

**Problem:** Mix of `vh`, `dvh`, `vw`, and `calc()` with viewport units:
- Some components use `100vh`, others use `100dvh`
- Viewport units in `clamp()` can cause issues on mobile browsers with dynamic toolbars
- Inconsistent handling of safe areas

**Impact:**
- Layout shifts when mobile browser UI shows/hides
- Content cut off on devices with notches
- Inconsistent spacing across devices

**Recommendation:**
- **Standardize on `dvh` (dynamic viewport height)** for full-height containers
- Use `env(safe-area-inset-*)` consistently for notched devices
- Create utility classes for common viewport patterns
- Use `min-height: 100dvh` instead of `height: 100dvh` to allow content overflow

### 5. **Text Overflow Handling**

**Problem:** Inconsistent text truncation:
- Some components use `text-overflow: ellipsis`
- Others allow wrapping
- Global CSS forces wrapping everywhere

**Impact:**
- Exercise names, labels, and titles break inappropriately
- Inconsistent visual treatment

**Recommendation:**
- **Create utility classes:**
  - `.truncate` - single line with ellipsis
  - `.truncate-2` - two lines with ellipsis
  - `.truncate-3` - three lines with ellipsis
- Apply truncation based on content type:
  - **Names/Labels:** Single-line truncate
  - **Descriptions:** Multi-line truncate (2-3 lines)
  - **Long-form text:** Allow wrapping
- Use `line-clamp` for multi-line truncation

### 6. **Container Sizing Strategy**

**Problem:** Hardcoded dimensions and inconsistent max-widths:
- ShareCard: `500px × 600px` hardcoded
- Various `max-height: calc(100vh - Xpx)` calculations
- Inconsistent padding/margin scaling

**Impact:**
- Doesn't adapt well to different screen sizes
- Content can overflow on small screens
- Inconsistent spacing

**Recommendation:**
- **Use CSS Container Queries** for component-level responsiveness
- Implement **fluid typography** with container-relative units
- Use **CSS Grid/Flexbox** with `minmax()` for responsive layouts
- Create a **spacing scale** using CSS custom properties
- Use `max-width: min(90vw, 500px)` instead of hardcoded `500px`

### 7. **Font Size Calculation Method**

**Problem:** JavaScript font sizing in ShareCard uses:
- Character count estimation (inaccurate)
- Scale factor that can go too low
- Doesn't account for font metrics (actual character width varies)

**Impact:**
- Text can be too small to read
- Inaccurate column width calculations
- Potential layout shifts

**Recommendation:**
- **Measure actual text width** using:
  - `Canvas.measureText()` for accurate width
  - `ResizeObserver` for container size changes
  - `getBoundingClientRect()` for element dimensions
- **Set minimum font sizes:**
  - Body text: 14px minimum
  - Labels: 12px minimum
  - Small text: 10px minimum
- **Use CSS-first approach** with fallback to JS only when necessary

## Recommended Implementation Strategy

### Phase 1: Foundation (High Priority)
1. **Remove aggressive global word-break rules**
   - Update `global.css` to use `overflow-wrap` instead of `word-break`
   - Add utility classes for truncation
   - Apply `white-space: nowrap` to names/labels/titles

2. **Unify typography scale**
   - Create consistent CSS custom properties using `rem` + `clamp()`
   - Define minimum readable sizes
   - Update all components to use the scale

3. **Standardize viewport units**
   - Use `dvh` consistently
   - Add safe area handling
   - Create viewport utility classes

### Phase 2: Component-Level (Medium Priority)
4. **Improve ShareCard autosizing**
   - Replace character estimation with actual text measurement
   - Use CSS Grid with `auto-fit` and `minmax()`
   - Implement minimum font size constraints
   - Add responsive breakpoints

5. **Create responsive utilities**
   - Truncation classes (`.truncate`, `.truncate-2`, etc.)
   - Container query utilities
   - Spacing scale

### Phase 3: Advanced (Lower Priority)
6. **Implement Container Queries**
   - Use `@container` queries for component-level responsiveness
   - Reduce JavaScript calculations
   - Better performance

7. **Optimize font loading**
   - Use `font-display: swap`
   - Preload critical fonts
   - Consider variable fonts for better scaling

## Specific Code Examples

### Example 1: Improved Typography Scale
```css
:root {
  /* Base font size - use rem for predictable scaling */
  --font-size-base: 16px;
  
  /* Typography scale using rem + clamp for responsive sizing */
  --text-xs: clamp(0.625rem, 0.5vw + 0.5rem, 0.6875rem);   /* 10-11px */
  --text-sm: clamp(0.75rem, 0.5vw + 0.5rem, 0.8125rem);    /* 12-13px */
  --text-base: clamp(0.875rem, 0.5vw + 0.5rem, 0.9375rem); /* 14-15px */
  --text-md: clamp(1rem, 0.5vw + 0.5rem, 1.0625rem);      /* 16-17px */
  --text-lg: clamp(1.0625rem, 0.5vw + 0.5rem, 1.1875rem);  /* 17-19px */
  --text-xl: clamp(1.25rem, 0.5vw + 0.5rem, 1.5rem);       /* 20-24px */
}
```

### Example 2: Truncation Utilities
```css
.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.truncate-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.truncate-3 {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```

### Example 3: Improved ShareCard Grid
```css
.exercisesGrid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(120px, 100%), 1fr));
  gap: clamp(0.25rem, 1vw, 0.5rem);
  max-height: 100%;
  overflow: hidden;
}

.exerciseName {
  font-size: clamp(0.625rem, 2vw + 0.25rem, 0.75rem); /* 10-12px */
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}
```

### Example 4: Better Text Measurement (JavaScript)
```javascript
// Measure actual text width instead of estimating
function measureTextWidth(text, fontSize, fontFamily) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  context.font = `${fontSize}px ${fontFamily}`;
  return context.measureText(text).width;
}
```

## Branding Considerations

1. **Exercise Names:** Never break mid-word - use `white-space: nowrap` + ellipsis
2. **Brand Name:** "Echelon" should never break - ensure proper handling
3. **Consistency:** All similar content types should use the same truncation strategy
4. **Readability:** Minimum font sizes should be enforced to maintain brand quality
5. **Visual Hierarchy:** Clear distinction between headings, body text, and labels

## Performance Considerations

1. **Reduce JavaScript calculations** - Use CSS when possible
2. **Avoid layout shifts** - Set explicit dimensions or use aspect ratios
3. **Optimize font loading** - Use `font-display: swap`
4. **Use CSS containment** - `contain: layout style paint` for isolated components
5. **Lazy measure** - Only measure text when necessary, cache results

## Testing Checklist

- [ ] Test on various screen sizes (320px to 1920px width)
- [ ] Test on devices with notches (iPhone X+)
- [ ] Test with long exercise names
- [ ] Test with short exercise names
- [ ] Verify no words break inappropriately
- [ ] Verify minimum font sizes are readable
- [ ] Test ShareCard with 1, 5, 10, 20+ exercises
- [ ] Verify no horizontal scrolling
- [ ] Test with different font sizes (accessibility)
- [ ] Verify consistent spacing across components

