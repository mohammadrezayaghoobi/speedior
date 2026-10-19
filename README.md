# راهنمای راه‌اندازی

## ۱) جایگزینی دامنه
در همه فایل‌ها عبارت `YOUR-DOMAIN.com` را با دامنه خودتان (بدون www) عوض کنید:

    sed -i 's/YOUR-DOMAIN\.com/example.ir/g' index.html robots.txt sitemap.xml

## ۲) آپلود
همه فایل‌ها (از جمله `.htaccess`) را در ریشه `public_html` آپلود کنید.
اگر وب‌سرور شما Nginx است، `.htaccess` کار نمی‌کند: ریدایرکت HTTPS، فشرده‌سازی، کش و هدرهای امنیتی را در تنظیمات Nginx بنویسید.

## ۳) بعد از آپلود
1. در Google Search Console دامنه را اضافه کنید و `https://دامنه-شما/sitemap.xml` را ثبت کنید.
2. با ابزار URL Inspection صفحه اصلی را «Request indexing» کنید.
3. همین کار را در Bing Webmaster Tools انجام دهید.
4. با Rich Results Test (search.google.com/test/rich-results) صحت FAQ و WebApplication را بررسی کنید.
5. با PageSpeed Insights سرعت صفحه را بسنجید.

## ۴) نکته
دکمه ذخیره تصویر و تست سرعت به `speed.cloudflare.com` وابسته‌اند؛ اگر CSP را تغییر دادید این دامنه باید در `connect-src` بماند.
