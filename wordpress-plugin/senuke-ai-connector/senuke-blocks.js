(function (wp) {
  if (!wp || !wp.blocks || !wp.element || !wp.blockEditor || !wp.components) return;

  var el = wp.element.createElement;
  var Fragment = wp.element.Fragment;
  var RichText = wp.blockEditor.RichText;
  var InspectorControls = wp.blockEditor.InspectorControls;
  var MediaUpload = wp.blockEditor.MediaUpload;
  var MediaUploadCheck = wp.blockEditor.MediaUploadCheck;
  var InnerBlocks = wp.blockEditor.InnerBlocks;
  var useBlockProps = wp.blockEditor.useBlockProps;
  var useInnerBlocksProps = wp.blockEditor.useInnerBlocksProps;
  var PanelBody = wp.components.PanelBody;
  var TextControl = wp.components.TextControl;
  var SelectControl = wp.components.SelectControl;
  var Button = wp.components.Button;
  var TextareaControl = wp.components.TextareaControl;

  if (wp.richText && wp.blockEditor.RichTextToolbarButton && (!wp.richText.getFormatType || !wp.richText.getFormatType("senuke/underline"))) {
    wp.richText.registerFormatType("senuke/underline", {
      title: "Underline",
      tagName: "span",
      className: "senuke-inline-underline",
      edit: function (formatProps) {
        return el(wp.blockEditor.RichTextToolbarButton, {
          icon: "editor-underline",
          title: "Underline",
          isActive: formatProps.isActive,
          onClick: function () {
            formatProps.onChange(wp.richText.toggleFormat(formatProps.value, { type: "senuke/underline" }));
          }
        });
      }
    });
  }

  function SeoDocumentPanel() {
    if (!wp.data || !wp.plugins) return null;
    var editorUi = wp.editor || wp.editPost || {};
    var editorState = wp.data.useSelect(function (select) {
      var store = select("core/editor");
      return { meta: store.getEditedPostAttribute("meta") || {}, postType: store.getCurrentPostType() || "" };
    }, []);
    if (["page", "post"].indexOf(editorState.postType) === -1) return null;
    var meta = editorState.meta;
    var editPost = wp.data.useDispatch("core/editor").editPost;
    var updateMeta = function (key, value) {
      var next = {}; next[key] = value; editPost({ meta: next });
    };
    var fields = [
      el(TextControl, { label: "SEO title", value: meta._senuke_meta_title || "", onChange: function (value) { updateMeta("_senuke_meta_title", value); }, help: "The public search title. Leave blank to use the WordPress page title." }),
      el(TextareaControl, { label: "Meta description", value: meta._senuke_meta_description || "", onChange: function (value) { updateMeta("_senuke_meta_description", value); } }),
      el(TextControl, { label: "Canonical URL", value: meta._senuke_canonical_url || "", onChange: function (value) { updateMeta("_senuke_canonical_url", value); } }),
      el(SelectControl, { label: "Search visibility", value: meta._senuke_robots || "index, follow", options: [{ label: "Index and follow", value: "index, follow" }, { label: "No index, follow links", value: "noindex, follow" }, { label: "No index and no follow", value: "noindex, nofollow" }], onChange: function (value) { updateMeta("_senuke_robots", value); } }),
      el(TextareaControl, { label: "Schema JSON-LD", value: meta._senuke_schema_json || "", onChange: function (value) { updateMeta("_senuke_schema_json", value); }, help: "Advanced: keep valid JSON-LD only." })
    ];
    if (editorUi.PluginSidebar) return el(editorUi.PluginSidebar, { name: "senuke-page-seo", title: "SENuke Page SEO", icon: "search", className: "senuke-page-seo" }, el("div", { className: "senuke-page-seo-fields" }, fields));
    if (editorUi.PluginDocumentSettingPanel) return el(editorUi.PluginDocumentSettingPanel, { name: "senuke-page-seo", title: "SENuke Page SEO", className: "senuke-page-seo" }, fields);
    return null;
  }

  if (wp.plugins && ((wp.editor && (wp.editor.PluginSidebar || wp.editor.PluginDocumentSettingPanel)) || (wp.editPost && (wp.editPost.PluginSidebar || wp.editPost.PluginDocumentSettingPanel)))) {
    wp.plugins.registerPlugin("senuke-page-settings", { render: SeoDocumentPanel, icon: "search" });
  }

  var definitions = {
    "senuke/local-service-hero": { title: "SENuke Hero", icon: "cover-image", fields: [["eyebrow", "Eyebrow"], ["headline", "Headline"], ["summary", "Summary"], ["primaryCtaLabel", "Button label"], ["primaryCtaUrl", "Button URL"]], image: true },
    "senuke/rich-text": { title: "SENuke Rich Text", icon: "text-page", fields: [["heading", "Heading"], ["body", "Content"]] },
    "senuke/image": { title: "SENuke Image", icon: "format-image", fields: [["altText", "Alt text"], ["caption", "Caption"]], image: true },
    "senuke/service-grid": { title: "SENuke Service Grid", icon: "grid-view", fields: [["heading", "Heading"], ["introduction", "Introduction"]], list: "items", itemFields: [["title", "Title"], ["description", "Description"], ["url", "URL"]] },
    "senuke/benefits": { title: "SENuke Benefits", icon: "yes-alt", fields: [["heading", "Heading"]], list: "items", itemFields: [["title", "Title"], ["description", "Description"]] },
    "senuke/process": { title: "SENuke Process", icon: "editor-ol", fields: [["heading", "Heading"]], list: "steps", itemFields: [["title", "Step title"], ["description", "Step description"]] },
    "senuke/proof": { title: "SENuke Trust & Proof", icon: "shield", fields: [["heading", "Heading"], ["introduction", "Introduction"]], list: "items", itemFields: [["title", "Title"], ["description", "Detail"]] },
    "senuke/faq": { title: "SENuke FAQ", icon: "editor-help", fields: [["heading", "Heading"]], list: "items", itemFields: [["question", "Question"], ["answer", "Answer"]] },
    "senuke/cta": { title: "SENuke Call to Action", icon: "button", fields: [["heading", "Heading"], ["body", "Message"], ["buttonLabel", "Button label"], ["buttonUrl", "Button URL"]] },
    "senuke/contact-form": { title: "SENuke Contact Form", icon: "email-alt", fields: [["heading", "Heading"], ["introduction", "Introduction"], ["submitLabel", "Submit label"], ["successMessage", "Success message"]] },
    "senuke/section-layout": { title: "SENuke Section", icon: "columns", fields: [] },
    "senuke/header": { title: "SENuke Header", icon: "align-wide", fields: [["businessName", "Business name"], ["primaryCtaLabel", "Button label"], ["primaryCtaUrl", "Button URL"]] },
    "senuke/navigation": { title: "SENuke Managed Navigation", icon: "menu", fields: [] },
    "senuke/footer": { title: "SENuke Footer", icon: "align-wide", fields: [["businessName", "Business name"], ["summary", "Summary"]] }
  };

  function updateProps(setAttributes, current, patch) {
    setAttributes({ props: Object.assign({}, current || {}, patch) });
  }

  function editableField(key, label, value, update) {
    var tag = /headline/i.test(key) ? "h1" : /heading|title|question/i.test(key) ? "h2" : "p";
    var multiline = /body|summary|description|introduction|answer|message/i.test(key) ? "p" : undefined;
    return el("div", { className: "senuke-block-field senuke-block-field-" + key, key: key },
      el("span", { className: "senuke-block-field-label" }, label),
      el(RichText, { tagName: tag, multiline: multiline, value: value || "", allowedFormats: ["core/bold", "core/italic", "core/link", "core/strikethrough", "senuke/underline"], onChange: update, placeholder: label })
    );
  }

  function listEditor(definition, props, setAttributes) {
    if (!definition.list) return null;
    var items = Array.isArray(props[definition.list]) ? props[definition.list] : [];
    var setItems = function (next) { updateProps(setAttributes, props, (function () { var patch = {}; patch[definition.list] = next; return patch; })()); };
    return el("div", { className: "senuke-block-items" },
      items.map(function (item, index) {
        return el("div", { className: "senuke-block-item", key: index },
          definition.itemFields.map(function (field) {
            return editableField(field[0], field[1], item[field[0]], function (value) {
              var next = items.slice(); next[index] = Object.assign({}, item); next[index][field[0]] = value; setItems(next);
            });
          }),
          el(Button, { isDestructive: true, isSmall: true, onClick: function () { setItems(items.filter(function (_, itemIndex) { return itemIndex !== index; })); } }, "Remove")
        );
      }),
      el(Button, { variant: "secondary", onClick: function () { var item = {}; definition.itemFields.forEach(function (field) { item[field[0]] = ""; }); setItems(items.concat([item])); } }, "+ Add item")
    );
  }

  Object.keys(definitions).forEach(function (name) {
    var definition = definitions[name];
    wp.blocks.registerBlockType(name, {
      apiVersion: 2,
      title: definition.title,
      icon: definition.icon,
      category: "senuke-sections",
      attributes: {
        componentId: { type: "string" },
        instanceId: { type: "string" },
        componentVersion: { type: "string", default: "1.0.0" },
        variant: { type: "string", default: "standard" },
        props: { type: "object", default: {} },
        lock: { type: "object" },
        align: { type: "string" },
        style: { type: "object" },
        backgroundColor: { type: "string" },
        textColor: { type: "string" },
        gradient: { type: "string" },
        fontSize: { type: "string" }
      },
      supports: {
        html: false,
        reusable: true,
        anchor: true,
        align: ["wide", "full"],
        color: { background: true, text: true, gradients: true },
        spacing: { padding: true, margin: true, blockGap: true },
        typography: { fontSize: true, lineHeight: true },
        border: { color: true, radius: true, style: true, width: true }
      },
      edit: function (blockProps) {
        var attributes = blockProps.attributes;
        var props = attributes.props || {};
        var setAttributes = blockProps.setAttributes;
        var children = [];
        if (name === "senuke/navigation") {
          return el("div", useBlockProps({ className: "senuke-gutenberg-editor senuke-navigation-editor" }),
            el("div", { className: "senuke-block-label" }, definition.title),
            el("p", null, (props.location === "footer" ? "Footer" : "Primary") + " navigation is synchronized from the approved SENuke Navigation step."),
            el("p", { className: "senuke-block-governance" }, "Change menu labels, order, groups, and page destinations in SENuke, then update the WordPress drafts or publish the approved release again.")
          );
        } else if (name === "senuke/section-layout") {
          var innerBlocksProps = useInnerBlocksProps(useBlockProps({ className: "senuke-gutenberg-editor senuke-layout-editor " + (blockProps.className || "") }), {
            allowedBlocks: ["core/columns"],
            renderAppender: InnerBlocks.ButtonBlockAppender
          });
          return el(Fragment, null,
            el(InspectorControls, null, el(PanelBody, { title: "Section settings", initialOpen: true },
              el(TextControl, { label: "Section ID", value: attributes.instanceId || "", disabled: true }),
              el("p", { className: "senuke-block-governance" }, "Use Gutenberg’s Styles panel for section colours, spacing, borders, width, and typography. Columns and nested blocks can be added, moved, duplicated, or removed."))),
            el("section", innerBlocksProps)
          );
        } else {
          definition.fields.forEach(function (field) {
            children.push(editableField(field[0], field[1], props[field[0]], function (value) { var patch = {}; patch[field[0]] = value; updateProps(setAttributes, props, patch); }));
          });
          children.push(listEditor(definition, props, setAttributes));
        }
        if (definition.image) {
          children.push(el("div", { className: "senuke-block-image-control", key: "image" },
            props.imageUrl ? el("img", { src: props.imageUrl, alt: props.imageAltText || props.altText || "" }) : el("div", { className: "senuke-block-image-placeholder" }, "No image selected"),
            el(MediaUploadCheck, null, el(MediaUpload, { allowedTypes: ["image"], value: props.imageAttachmentId || 0, onSelect: function (media) { updateProps(setAttributes, props, { imageAttachmentId: media.id, imageUrl: media.url, imageAltText: media.alt || "" }); }, render: function (control) { return el(Button, { variant: "secondary", onClick: control.open }, props.imageUrl ? "Change image" : "Choose image"); } }))
          ));
        }
        return el(Fragment, null,
          el(InspectorControls, null, el(PanelBody, { title: "SENuke section settings", initialOpen: true },
            el(TextControl, { label: "Section ID", value: attributes.instanceId || "", disabled: true }),
            el(SelectControl, { label: "Alignment", value: props.alignment || "left", options: [{ label: "Left", value: "left" }, { label: "Centre", value: "center" }, { label: "Right", value: "right" }], onChange: function (value) { updateProps(setAttributes, props, { alignment: value }); } }),
            el("p", { className: "senuke-block-governance" }, "Edit the text directly, use the toolbar for bold, italic, underline and links, and use Gutenberg Styles for colours, typography, spacing and borders. This block can be moved, duplicated or deleted."))),
          el("section", useBlockProps({ className: "senuke-gutenberg-editor " + (blockProps.className || "") }), el("div", { className: "senuke-block-label" }, definition.title), children)
        );
      },
      save: name === "senuke/section-layout" ? function () { return el(InnerBlocks.Content); } : function () { return null; }
    });
  });
})(window.wp);
