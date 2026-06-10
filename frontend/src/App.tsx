import { useState, Fragment } from 'react'
import './App.css'

interface CartItem {
  id: number
  name: string
  variant: string
  price: number
  qty: number
  color: string
}

const initialItems: CartItem[] = [
  { id: 1, name: 'Merino Wool Sweater',   variant: 'Size M · Ivory',      price: 189, qty: 1, color: '#EFE0D0' },
  { id: 2, name: 'Slim Chino Trousers',   variant: 'Size 32×30 · Navy',   price: 94,  qty: 2, color: '#C1D1E4' },
  { id: 3, name: 'Leather Chelsea Boots', variant: 'EU 42 · Cognac',      price: 320, qty: 1, color: '#D8C4B5' },
]

function App() {
  const [items, setItems] = useState<CartItem[]>(initialItems)
  const [promo, setPromo] = useState('')

  function updateQty(id: number, delta: number) {
    setItems(prev =>
      prev.map(item =>
        item.id === id ? { ...item, qty: Math.max(1, item.qty + delta) } : item
      )
    )
  }

  function removeItem(id: number) {
    setItems(prev => prev.filter(item => item.id !== id))
  }

  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0)
  const tax = Math.round(subtotal * 0.08 * 100) / 100
  const total = subtotal + tax

  return (
    <div className="cart-page">
      <nav className="navbar">
        <span className="nav-logo">MAISON</span>
        <div className="nav-links">
          <a href="#">Shop</a>
          <a href="#">Collections</a>
          <a href="#">About</a>
          <a href="#" className="nav-cart-active">Cart ({items.length})</a>
        </div>
      </nav>

      <main className="cart-main">
        <div className="cart-heading">
          <h1>Shopping Cart</h1>
          <p>{items.length} item{items.length !== 1 ? 's' : ''}</p>
        </div>

        <div className="cart-columns">
          <div className="product-list">
            {items.length === 0 ? (
              <div className="cart-empty">Your cart is empty.</div>
            ) : (
              items.map((item, i) => (
                <Fragment key={item.id}>
                  <div className="product-row">
                    <div className="product-img" style={{ backgroundColor: item.color }} />
                    <div className="product-info">
                      <span className="product-name">{item.name}</span>
                      <span className="product-variant">{item.variant}</span>
                      <button className="remove-btn" onClick={() => removeItem(item.id)}>
                        Remove
                      </button>
                    </div>
                    <div className="qty-control">
                      <button onClick={() => updateQty(item.id, -1)}>−</button>
                      <span>{item.qty}</span>
                      <button onClick={() => updateQty(item.id, +1)}>+</button>
                    </div>
                    <span className="product-price">${item.price}</span>
                  </div>
                  {i < items.length - 1 && <div className="row-divider" />}
                </Fragment>
              ))
            )}
          </div>

          <aside className="order-summary">
            <div className="summary-header">
              <h2>Order Summary</h2>
            </div>
            <div className="summary-divider" />
            <div className="summary-rows">
              <div className="summary-row">
                <span>Subtotal</span>
                <span>${subtotal.toFixed(2)}</span>
              </div>
              <div className="summary-row">
                <span>Shipping</span>
                <strong>Free</strong>
              </div>
              <div className="summary-row">
                <span>Estimated tax</span>
                <span>${tax.toFixed(2)}</span>
              </div>
            </div>
            <div className="summary-divider" />
            <div className="summary-total">
              <strong>Total</strong>
              <strong>${total.toFixed(2)}</strong>
            </div>
            <div className="summary-divider" />
            <div className="promo-section">
              <label className="promo-label">Promo code</label>
              <div className="promo-row">
                <input
                  className="promo-input"
                  placeholder="Enter promo code"
                  value={promo}
                  onChange={e => setPromo(e.target.value)}
                />
                <button className="apply-btn">Apply</button>
              </div>
            </div>
            <div className="summary-divider" />
            <div className="checkout-section">
              <button className="checkout-btn">Checkout →</button>
              <p className="trust-text">Secure checkout · Free returns</p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  )
}

export default App
