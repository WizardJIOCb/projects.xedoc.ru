(() => {
  const grid = document.querySelector("[data-product-grid]");
  const modal = document.querySelector("[data-product-modal]");
  if (!grid || !modal) {
    return;
  }

  const products = new Map();
  const cartKey = "shamanchik_cart_v1";
  const fallbackImage = "/images/product-reishi.png";
  const state = {
    cart: loadCart(),
    settings: { deliveryEnabled: true, paymentEnabled: true, cdekReady: false, yookassaReady: false },
    checkout: {
      city: null,
      points: [],
      selectedPoint: null,
      delivery: null
    }
  };

  const modalEls = {
    image: modal.querySelector("[data-product-modal-image]"),
    title: modal.querySelector("[data-product-modal-title]"),
    meta: modal.querySelector("[data-product-modal-meta]"),
    description: modal.querySelector("[data-product-modal-description]"),
    facts: modal.querySelector("[data-product-modal-facts]"),
    order: modal.querySelector("[data-product-modal-order]")
  };

  const cartEls = createCartUi();

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function money(value) {
    return `${Number(value || 0).toLocaleString("ru-RU")} ₽`;
  }

  function safeImageUrl(value) {
    const url = String(value || "").trim();
    if (/^(\/images\/|images\/|https?:\/\/)/i.test(url)) {
      return url;
    }
    return fallbackImage;
  }

  function setImage(element, imageUrl) {
    element.style.setProperty("--image", `url("${safeImageUrl(imageUrl).replace(/"/g, "%22")}")`);
  }

  function loadCart() {
    try {
      const parsed = JSON.parse(localStorage.getItem(cartKey) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveCart() {
    localStorage.setItem(cartKey, JSON.stringify(state.cart));
  }

  function modalImagePosition(product) {
    const slug = String(product.slug || "").toLowerCase();
    if (slug.includes("шиитаке")) return "64% center";
    if (slug.includes("мейтаке")) return "61% center";
    if (slug.includes("ежовика")) return "54% center";
    if (slug.includes("кордицепса")) return "48% center";
    return "52% center";
  }

  function cardImagePosition(product) {
    const slug = String(product.slug || "").toLowerCase();
    if (slug.includes("шиитаке")) return "66% center";
    if (slug.includes("мейтаке")) return "63% center";
    if (slug.includes("ежовика")) return "55% center";
    if (slug.includes("кордицепса")) return "48% center";
    if (slug.includes("рейши")) return "53% center";
    if (slug.includes("траметеса")) return "52% center";
    return "center";
  }

  function setModalImage(product) {
    setImage(modalEls.image, product.imageUrl);
    modalEls.image.style.setProperty("--modal-pos", modalImagePosition(product));
    modalEls.image.style.setProperty("--modal-size", "auto 96%");
  }

  function priceOptions(product) {
    if (product.priceOptions?.length) {
      return product.priceOptions;
    }
    return [{ unit: product.unit || product.subtitle || "шт", price: Number(product.price || 0) }];
  }

  function firstOption(product) {
    return priceOptions(product)[0];
  }

  function formatPrice(product) {
    const option = firstOption(product);
    if (!Number(option?.price)) {
      return "По запросу";
    }
    return product.priceOptions?.length ? `от ${money(option.price)}` : money(option.price);
  }

  function formatPriceOption(option) {
    return `${option.unit} - ${money(option.price)}`;
  }

  function formatProductUnits(product) {
    if (product.priceOptions?.length) {
      return product.priceOptions.map((option) => option.unit).join(" / ");
    }
    return product.unit || product.subtitle || "";
  }

  function cartPayload() {
    return state.cart.map((item) => ({
      slug: item.slug,
      unit: item.unit,
      quantity: item.quantity
    }));
  }

  function cartTotals() {
    const subtotal = state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const deliveryPrice = state.checkout.delivery?.price || 0;
    return { subtotal, deliveryPrice, total: subtotal + deliveryPrice };
  }

  function addToCart(slug, unit) {
    const product = products.get(slug);
    if (!product) return;
    const option = priceOptions(product).find((item) => item.unit === unit) || firstOption(product);
    const key = `${slug}::${option.unit}`;
    const existing = state.cart.find((item) => item.key === key);
    if (existing) {
      existing.quantity += 1;
    } else {
      state.cart.push({
        key,
        slug,
        title: product.title,
        unit: option.unit,
        price: Number(option.price || 0),
        imageUrl: product.imageUrl,
        quantity: 1
      });
    }
    state.checkout.delivery = null;
    saveCart();
    renderCart();
    openCart();
  }

  function setCartQuantity(key, quantity) {
    const item = state.cart.find((entry) => entry.key === key);
    if (!item) return;
    item.quantity = Math.max(1, Math.min(99, quantity));
    state.checkout.delivery = null;
    saveCart();
    renderCart();
  }

  function removeCartItem(key) {
    state.cart = state.cart.filter((item) => item.key !== key);
    state.checkout.delivery = null;
    saveCart();
    renderCart();
  }

  function createCartUi() {
    const root = document.createElement("div");
    root.className = "cart-shell";
    root.innerHTML = `
      <button class="cart-fab" type="button" data-cart-open aria-label="Открыть корзину">
        <svg class="icon"><use href="#icon-cart"></use></svg>
        <span data-cart-count>0</span>
      </button>
      <div class="cart-panel" data-cart-panel hidden>
        <div class="cart-panel__backdrop" data-cart-close></div>
        <aside class="cart-panel__drawer" aria-label="Корзина">
          <header class="cart-panel__head">
            <div>
              <p class="cart-panel__eyebrow">Оформление</p>
              <h2>Корзина</h2>
            </div>
            <button class="product-modal__close" type="button" data-cart-close aria-label="Закрыть">×</button>
          </header>
          <div class="cart-panel__body">
            <div class="cart-list" data-cart-list></div>
            <form class="checkout-form" data-checkout-form>
              <h3>Покупатель</h3>
              <div class="checkout-grid">
                <label><span>Имя</span><input name="name" type="text" autocomplete="name" required></label>
                <label><span>Телефон</span><input name="phone" type="tel" autocomplete="tel" required></label>
              </div>
              <label><span>Email для чека</span><input name="email" type="email" autocomplete="email" placeholder="Можно добавить позже"></label>
              <label><span>Комментарий</span><textarea name="comment" rows="3" placeholder="Удобное время, пожелания к заказу"></textarea></label>
              <section class="checkout-delivery" data-delivery-section>
                <h3>Доставка CDEK</h3>
                <label><span>Город</span><input name="city" type="text" autocomplete="off" placeholder="Начните вводить город"></label>
                <div class="checkout-options" data-city-options></div>
                <label><span>Пункт выдачи</span><select name="point" disabled><option value="">Сначала выберите город</option></select></label>
                <p class="checkout-note" data-delivery-note>Стоимость доставки рассчитается после выбора пункта выдачи.</p>
              </section>
              <div class="cart-summary" data-cart-summary></div>
              <p class="checkout-error" data-checkout-error hidden></p>
              <button class="button button--gold checkout-submit" type="submit">Перейти к оплате</button>
            </form>
          </div>
        </aside>
      </div>
    `;
    document.body.appendChild(root);
    return {
      root,
      panel: root.querySelector("[data-cart-panel]"),
      count: root.querySelector("[data-cart-count]"),
      list: root.querySelector("[data-cart-list]"),
      form: root.querySelector("[data-checkout-form]"),
      deliverySection: root.querySelector("[data-delivery-section]"),
      cityInput: root.querySelector('input[name="city"]'),
      cityOptions: root.querySelector("[data-city-options]"),
      pointSelect: root.querySelector('select[name="point"]'),
      deliveryNote: root.querySelector("[data-delivery-note]"),
      summary: root.querySelector("[data-cart-summary]"),
      error: root.querySelector("[data-checkout-error]")
    };
  }

  function openCart() {
    cartEls.panel.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeCart() {
    cartEls.panel.hidden = true;
    if (modal.hidden) {
      document.body.style.overflow = "";
    }
  }

  function renderCardPrices(product) {
    if (!product.priceOptions?.length) return "";
    return `
      <div class="product-card__prices" data-product-open="${escapeHtml(product.slug)}" role="button" tabindex="0">
        ${product.priceOptions.map((option) => `<span>${escapeHtml(formatPriceOption(option))}</span>`).join("")}
      </div>
    `;
  }

  function productCard(product) {
    const description = product.shortDescription || product.description || product.composition || "";
    const option = firstOption(product);
    return `
      <article class="product-card" data-product-slug="${escapeHtml(product.slug)}">
        <div class="product-card__image" data-product-image="${escapeHtml(product.imageUrl || "")}" data-product-image-slug="${escapeHtml(product.slug)}" data-product-open="${escapeHtml(product.slug)}" role="button" tabindex="0" aria-label="Подробнее о ${escapeHtml(product.title)}"></div>
        <div class="product-card__body">
          <h3 data-product-open="${escapeHtml(product.slug)}" role="button" tabindex="0">${escapeHtml(product.title)}</h3>
          <p data-product-open="${escapeHtml(product.slug)}" role="button" tabindex="0">${escapeHtml(formatProductUnits(product))}</p>
          <p data-product-open="${escapeHtml(product.slug)}" role="button" tabindex="0">${escapeHtml(description.slice(0, 118))}${description.length > 118 ? "..." : ""}</p>
          ${renderCardPrices(product)}
          <button class="product-card__details" type="button" data-product-detail="${escapeHtml(product.slug)}">Подробнее</button>
          <div class="product-card__buy">
            <span class="price">${escapeHtml(formatPrice(product))}</span>
            <button class="cart-button" type="button" data-cart-add="${escapeHtml(product.slug)}" data-cart-unit="${escapeHtml(option.unit)}" aria-label="Добавить ${escapeHtml(product.title)} в корзину">
              <svg class="icon"><use href="#icon-cart"></use></svg>
            </button>
          </div>
        </div>
      </article>
    `;
  }

  function renderProducts(items) {
    if (!items.length) {
      grid.innerHTML = '<p class="product-card__empty">Каталог скоро появится.</p>';
      return;
    }
    products.clear();
    for (const product of items) products.set(product.slug, product);
    grid.innerHTML = items.map(productCard).join("");
    grid.querySelectorAll("[data-product-image]").forEach((element) => {
      setImage(element, element.dataset.productImage);
      const product = products.get(element.dataset.productImageSlug);
      if (product) element.style.setProperty("--card-pos", cardImagePosition(product));
    });
    state.cart = state.cart.filter((item) => products.has(item.slug));
    saveCart();
    renderCart();
  }

  function renderFacts(product) {
    const facts = [
      product.priceOptions?.length && ["Фасовки", product.priceOptions.map(formatPriceOption).join("; ")],
      product.dosage && ["Дозировка", product.dosage],
      product.composition && ["Состав", product.composition],
      product.notice && ["Важно", product.notice]
    ].filter(Boolean);
    modalEls.facts.innerHTML = facts.map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`).join("");
    modalEls.facts.hidden = !facts.length;
  }

  function renderBenefits(product) {
    if (!product.benefits?.length) return "";
    const firstBenefit = product.benefits[0] || "";
    if (firstBenefit && String(product.description || "").includes(firstBenefit)) return "";
    return `<ul>${product.benefits.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  }

  function modalDescription(product) {
    const source = product.description || product.shortDescription || "";
    return source
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line && !/^(Рекомендованная дозировка|Состав|Не является)/i.test(line))
      .join("\n\n");
  }

  function renderModalVariant(product) {
    let row = modal.querySelector("[data-product-modal-variant-row]");
    if (!row) {
      row = document.createElement("label");
      row.className = "product-modal__variant";
      row.dataset.productModalVariantRow = "";
      row.innerHTML = `<span>Фасовка</span><select data-product-modal-variant></select>`;
      modalEls.facts.insertAdjacentElement("afterend", row);
    }
    const select = row.querySelector("select");
    select.innerHTML = priceOptions(product).map((option) => `<option value="${escapeHtml(option.unit)}">${escapeHtml(formatPriceOption(option))}</option>`).join("");
    row.hidden = priceOptions(product).length <= 1;
  }

  function openProduct(slug) {
    const product = products.get(slug);
    if (!product) return;
    setModalImage(product);
    modalEls.title.textContent = product.title;
    modalEls.meta.textContent = [product.category, formatProductUnits(product), formatPrice(product)].filter(Boolean).join(" · ");
    modalEls.description.innerHTML = `${escapeHtml(modalDescription(product)).replace(/\n/g, "<br>")}${renderBenefits(product)}`;
    modalEls.order.removeAttribute("href");
    modalEls.order.textContent = "Добавить в корзину";
    modalEls.order.dataset.cartAddModal = product.slug;
    renderFacts(product);
    renderModalVariant(product);
    modal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    modal.hidden = true;
    if (cartEls.panel.hidden) {
      document.body.style.overflow = "";
    }
  }

  function renderCart() {
    const count = state.cart.reduce((sum, item) => sum + item.quantity, 0);
    cartEls.count.textContent = count;
    cartEls.root.classList.toggle("has-items", count > 0);
    if (!state.cart.length) {
      cartEls.list.innerHTML = '<p class="cart-empty">Корзина пока пустая.</p>';
      cartEls.form.hidden = true;
      return;
    }
    cartEls.form.hidden = false;
    cartEls.list.innerHTML = state.cart.map((item) => `
      <article class="cart-item">
        <span class="cart-item__image" style="--image: url('${escapeHtml(safeImageUrl(item.imageUrl))}')"></span>
        <span class="cart-item__info"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.unit)} · ${money(item.price)}</small></span>
        <span class="cart-item__qty">
          <button type="button" data-cart-dec="${escapeHtml(item.key)}">−</button>
          <b>${item.quantity}</b>
          <button type="button" data-cart-inc="${escapeHtml(item.key)}">+</button>
        </span>
        <strong class="cart-item__sum">${money(item.price * item.quantity)}</strong>
        <button class="cart-item__remove" type="button" data-cart-remove="${escapeHtml(item.key)}" aria-label="Убрать товар">×</button>
      </article>
    `).join("");
    cartEls.deliverySection.hidden = !state.settings.deliveryEnabled;
    renderSummary();
  }

  function renderSummary() {
    const totals = cartTotals();
    const deliveryLine = state.settings.deliveryEnabled
      ? `<span>Доставка CDEK</span><strong>${state.checkout.delivery ? money(totals.deliveryPrice) : "нужно выбрать ПВЗ"}</strong>`
      : `<span>Доставка</span><strong>отключена</strong>`;
    cartEls.summary.innerHTML = `
      <div><span>Товары</span><strong>${money(totals.subtotal)}</strong></div>
      <div>${deliveryLine}</div>
      <div class="cart-summary__total"><span>Итого</span><strong>${money(totals.total)}</strong></div>
    `;
    cartEls.deliveryNote.textContent = state.checkout.delivery
      ? `CDEK: ${money(state.checkout.delivery.price)}${state.checkout.delivery.periodMin ? `, ${state.checkout.delivery.periodMin}-${state.checkout.delivery.periodMax || state.checkout.delivery.periodMin} дн.` : ""}`
      : "Стоимость доставки рассчитается после выбора пункта выдачи.";
  }

  function showCheckoutError(message) {
    cartEls.error.textContent = message;
    cartEls.error.hidden = !message;
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      headers: options.body ? { "Content-Type": "application/json" } : {},
      ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Ошибка запроса.");
    }
    return data;
  }

  let cityTimer = null;
  function scheduleCitySearch() {
    window.clearTimeout(cityTimer);
    cityTimer = window.setTimeout(searchCities, 320);
  }

  async function searchCities() {
    const query = cartEls.cityInput.value.trim();
    state.checkout.city = null;
    state.checkout.selectedPoint = null;
    state.checkout.delivery = null;
    cartEls.pointSelect.disabled = true;
    cartEls.pointSelect.innerHTML = '<option value="">Сначала выберите город</option>';
    if (query.length < 2 || !state.settings.cdekReady) {
      cartEls.cityOptions.innerHTML = "";
      renderSummary();
      return;
    }
    try {
      const data = await fetchJson(`/chat-api/delivery/cities?q=${encodeURIComponent(query)}`);
      cartEls.cityOptions.innerHTML = (data.cities || []).map((city) => `
        <button type="button" data-city-code="${city.code}" data-city-name="${escapeHtml(city.name)}" data-city-region="${escapeHtml(city.region || "")}">
          ${escapeHtml(city.name)}${city.region ? `, ${escapeHtml(city.region)}` : ""}
        </button>
      `).join("");
    } catch (error) {
      showCheckoutError(error.message);
    }
  }

  async function selectCity(city) {
    state.checkout.city = city;
    state.checkout.selectedPoint = null;
    state.checkout.delivery = null;
    cartEls.cityInput.value = city.region ? `${city.name}, ${city.region}` : city.name;
    cartEls.cityOptions.innerHTML = "";
    cartEls.pointSelect.disabled = true;
    cartEls.pointSelect.innerHTML = '<option value="">Загрузка пунктов...</option>';
    try {
      const data = await fetchJson(`/chat-api/delivery/points?cityCode=${encodeURIComponent(city.code)}`);
      state.checkout.points = data.points || [];
      cartEls.pointSelect.disabled = !state.checkout.points.length;
      cartEls.pointSelect.innerHTML = '<option value="">Выберите пункт выдачи</option>' + state.checkout.points.map((point) => (
        `<option value="${escapeHtml(point.code)}">${escapeHtml(point.name)} · ${escapeHtml(point.address)}</option>`
      )).join("");
      renderSummary();
    } catch (error) {
      cartEls.pointSelect.innerHTML = '<option value="">Не удалось загрузить пункты</option>';
      showCheckoutError(error.message);
    }
  }

  async function calculateDelivery() {
    const code = cartEls.pointSelect.value;
    const point = state.checkout.points.find((item) => item.code === code);
    state.checkout.selectedPoint = point || null;
    state.checkout.delivery = null;
    if (!state.checkout.city || !point) {
      renderSummary();
      return;
    }
    try {
      const data = await fetchJson("/chat-api/delivery/calculate", {
        method: "POST",
        body: JSON.stringify({
          cityCode: state.checkout.city.code,
          deliveryPointCode: point.code,
          items: cartPayload()
        })
      });
      state.checkout.delivery = data.delivery;
      renderSummary();
    } catch (error) {
      showCheckoutError(error.message);
      renderSummary();
    }
  }

  async function submitOrder(event) {
    event.preventDefault();
    showCheckoutError("");
    if (!state.cart.length) return;
    if (state.settings.deliveryEnabled && (!state.checkout.city || !state.checkout.selectedPoint || !state.checkout.delivery)) {
      showCheckoutError("Выберите город и пункт выдачи CDEK.");
      return;
    }
    const form = new FormData(cartEls.form);
    const delivery = state.settings.deliveryEnabled ? {
      cityCode: state.checkout.city.code,
      cityName: state.checkout.city.name,
      deliveryPointCode: state.checkout.selectedPoint.code,
      pointName: state.checkout.selectedPoint.name,
      pointAddress: state.checkout.selectedPoint.address
    } : null;
    const submit = cartEls.form.querySelector(".checkout-submit");
    submit.disabled = true;
    submit.textContent = "Создаём заказ...";
    try {
      const data = await fetchJson("/chat-api/orders", {
        method: "POST",
        body: JSON.stringify({
          customer: {
            name: form.get("name"),
            phone: form.get("phone"),
            email: form.get("email"),
            comment: form.get("comment")
          },
          delivery,
          items: cartPayload()
        })
      });
      if (data.paymentUrl) {
        state.cart = [];
        saveCart();
        window.location.href = data.paymentUrl;
        return;
      }
      showCheckoutError("Заказ создан, но ссылка на оплату не получена. Проверьте настройки ЮКассы.");
    } catch (error) {
      showCheckoutError(error.message === "YooKassa is not configured." ? "ЮКасса пока не настроена: пропишите ключи на сервере." : error.message);
    } finally {
      submit.disabled = false;
      submit.textContent = "Перейти к оплате";
    }
  }

  grid.addEventListener("click", (event) => {
    const addButton = event.target.closest("[data-cart-add]");
    if (addButton) {
      event.preventDefault();
      addToCart(addButton.dataset.cartAdd, addButton.dataset.cartUnit);
      return;
    }
    const opener = event.target.closest("[data-product-detail], [data-product-open]");
    if (opener) openProduct(opener.dataset.productDetail || opener.dataset.productOpen);
  });

  grid.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const opener = event.target.closest("[data-product-open]");
    if (opener) {
      event.preventDefault();
      openProduct(opener.dataset.productOpen);
    }
  });

  modal.addEventListener("click", (event) => {
    if (event.target.closest("[data-product-close]")) {
      closeModal();
      return;
    }
    const modalAdd = event.target.closest("[data-cart-add-modal]");
    if (modalAdd) {
      event.preventDefault();
      const select = modal.querySelector("[data-product-modal-variant]");
      addToCart(modalAdd.dataset.cartAddModal, select?.value || "");
      closeModal();
    }
  });

  cartEls.root.addEventListener("click", (event) => {
    if (event.target.closest("[data-cart-open]")) openCart();
    if (event.target.closest("[data-cart-close]")) closeCart();
    const inc = event.target.closest("[data-cart-inc]");
    const dec = event.target.closest("[data-cart-dec]");
    const remove = event.target.closest("[data-cart-remove]");
    if (inc) {
      const item = state.cart.find((entry) => entry.key === inc.dataset.cartInc);
      if (item) setCartQuantity(item.key, item.quantity + 1);
    }
    if (dec) {
      const item = state.cart.find((entry) => entry.key === dec.dataset.cartDec);
      if (item) setCartQuantity(item.key, item.quantity - 1);
    }
    if (remove) removeCartItem(remove.dataset.cartRemove);
  });

  cartEls.cityInput.addEventListener("input", scheduleCitySearch);
  cartEls.cityOptions.addEventListener("click", (event) => {
    const button = event.target.closest("[data-city-code]");
    if (!button) return;
    selectCity({ code: button.dataset.cityCode, name: button.dataset.cityName, region: button.dataset.cityRegion });
  });
  cartEls.pointSelect.addEventListener("change", calculateDelivery);
  cartEls.form.addEventListener("submit", submitOrder);

  document.addEventListener("click", (event) => {
    const navCart = event.target.closest('a[href="#products"] .icon, a[aria-label="Корзина"]');
    if (navCart) {
      const link = event.target.closest("a");
      if (link?.getAttribute("aria-label") === "Корзина") {
        event.preventDefault();
        openCart();
      }
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!modal.hidden) closeModal();
      if (!cartEls.panel.hidden) closeCart();
    }
  });

  Promise.all([
    fetch("/chat-api/store/settings", { credentials: "same-origin" }).then((response) => response.ok ? response.json() : {}),
    fetch("/chat-api/products", { credentials: "same-origin" }).then((response) => {
      if (!response.ok) throw new Error("Catalog unavailable");
      return response.json();
    })
  ])
    .then(([settings, data]) => {
      state.settings = { ...state.settings, ...settings };
      if (!state.settings.cdekReady) {
        cartEls.deliveryNote.textContent = "CDEK появится после настройки ключей и города отправления.";
      }
      renderProducts(data.products || []);
    })
    .catch(() => {
      renderCart();
      grid.querySelectorAll(".product-card__image").forEach((element) => {
        const match = String(element.getAttribute("style") || "").match(/url\(['"]?([^'")]+)['"]?\)/);
        if (match) setImage(element, match[1]);
      });
    });
})();