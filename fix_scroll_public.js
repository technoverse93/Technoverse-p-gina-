const fs = require('fs');
let content = fs.readFileSync('src/components/PublicStore.tsx', 'utf8');

const hookStr = `
  useEffect(() => {
    if (isCartOpen || selectedProductDetail || showAuthModal || showPurchaseSuccess || isMobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'auto';
    }
    return () => { document.body.style.overflow = 'auto'; };
  }, [isCartOpen, selectedProductDetail, showAuthModal, showPurchaseSuccess, isMobileMenuOpen]);
`;

if (!content.includes('document.body.style.overflow')) {
  content = content.replace('const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);', 'const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);\n' + hookStr);
  fs.writeFileSync('src/components/PublicStore.tsx', content);
}
