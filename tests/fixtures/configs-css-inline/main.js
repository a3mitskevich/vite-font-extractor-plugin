import css from './index.css?inline'

const style = document.createElement('style')
style.textContent = css
document.head.append(style)
