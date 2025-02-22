#FROM public.ecr.aws/aws-observability/aws-for-fluent-bit:stable 
FROM amazon/aws-for-fluent-bit:debug-latest
RUN mkdir -p /fluent-bit/etc
COPY fluent-bit.conf /fluent-bit/etc/