/* ------------------------------------------------------------------
   UI COMPONENT FACTORY - js/UIFactory.js
   A central generator for consistent Measurely input fields
------------------------------------------------------------------ */

export const UIFactory = {
    /**
     * Renders a unified Measurely field row containing a label, an optional subtext, 
     * a form input (slider, toggle, or select), and a live value display.
     * 
     * @param {Object} fieldConfig - Configuration defining the input
     * @param {string|number|boolean} currentValue - the initialized value
     * @returns {string} HTML string representing the field
     */
    renderField: function(fieldConfig, currentValue) {
        const type = fieldConfig.type || 'slider';
        const disabledAttr = fieldConfig.disabled ? 'disabled' : '';
        const instantClass = fieldConfig.instant ? ' field--instant' : '';

        let inputHtml = '';
        let displayHtml = '';

        if (type === 'slider') {
            const min = fieldConfig.min || 0;
            const max = fieldConfig.max || 100;
            const step = fieldConfig.step || 1;
            const formatRules = fieldConfig.displayFormat || { suffix: '' };
            const suff = formatRules.suffix || '';
            const isInt = step >= 1;

            const displayVal = isInt 
                ? Number(currentValue).toFixed(0) 
                : Number(currentValue).toFixed(2);

            // Compute background fill percentage inline for initial render
            const fillPct = ((currentValue - min) / (max - min)) * 100;

            inputHtml = `
                <input 
                    type="range" 
                    class="measurely-slider" 
                    data-key="${fieldConfig.key}" 
                    min="${min}" 
                    max="${max}" 
                    step="${step}" 
                    value="${currentValue}"
                    style="--fill: ${fillPct}%"
                    ${disabledAttr}
                >
            `;
            // Fixed width container for the number so layout doesn't jump
            displayHtml = `
                <div class="value">
                    <span class="js-val-display">${displayVal}</span>
                    <span class="js-val-suffix">${suff}</span>
                </div>
            `;
        } 
        else if (type === 'toggle') {
            const isChecked = currentValue ? 'checked' : '';
            inputHtml = `
                <label class="measurely-switch">
                    <input 
                        type="checkbox" 
                        data-key="${fieldConfig.key}" 
                        ${isChecked} 
                        ${disabledAttr}
                    >
                    <span class="slider"></span>
                </label>
            `;
            // Toggles don't typically have a discrete changing value text, just the switch
            displayHtml = ''; 
        }
        else if (type === 'select') {
            const options = fieldConfig.options || [];
            const optionHtml = options.map(opt => `
                <option value="${opt.value}" ${currentValue === opt.value ? 'selected' : ''} ${opt.disabled ? 'disabled' : ''}>
                    ${opt.label}
                </option>
            `).join('');

            inputHtml = `
                <select class="measurely-select" data-key="${fieldConfig.key}" ${disabledAttr}>
                    ${optionHtml}
                </select>
            `;
            displayHtml = '';
        }

        // Subtext is optional
        const subHtml = fieldConfig.sub 
            ? `<div class="sub">${fieldConfig.sub}</div>` 
            : '';

        // Determine if header needs to be flex to accommodate toggle/values
        const needsFlexHeader = type === 'toggle' || displayHtml !== '';

        if (needsFlexHeader) {
            return `
                <div class="field${instantClass}">
                    <div class="field-head">
                        <label>${fieldConfig.label}</label>
                        ${type === 'toggle' ? inputHtml : displayHtml}
                    </div>
                    ${subHtml}
                    ${type === 'toggle' ? '' : inputHtml}
                </div>
            `;
        } else {
            return `
                <div class="field${instantClass}">
                    <label>${fieldConfig.label}</label>
                    ${subHtml}
                    ${inputHtml}
                </div>
            `;
        }
    }
};
